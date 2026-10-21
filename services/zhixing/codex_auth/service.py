from __future__ import annotations
from typing import Any
"""Single-user orchestration adapted from DeepTutor; no DeepTutor/CLI state access."""
import asyncio
import time
import secrets
from dataclasses import replace
from urllib.parse import urlsplit, parse_qs
import httpx
from .constants import CODEX_CALLBACK_PORTS, CODEX_CALLBACK_PATH, CODEX_LOGIN_TIMEOUT_SECONDS
from .contracts import CodexAuthError, CodexCredentials, CatalogSnapshot, decode_codex_jwt
from .oauth import CodexOAuthClient, LoopbackCallback, generate_pkce, build_authorize_url, oauth_state_matches
from .storage import CodexCredentialStore
from .catalog import CodexModelCatalog


class CodexService:
    def __init__(self, root, http=None, clock=time.time):
        self.store = CodexCredentialStore(root)
        self.http = http or httpx.AsyncClient(timeout=30, follow_redirects=False)
        self.oauth = CodexOAuthClient(self.http)
        self.catalog = CodexModelCatalog(self.store, http=self.http, clock=clock)
        self.clock = clock
        self.refresh_lock = asyncio.Lock()
        self.operation_lock = asyncio.Lock()
        self.operation = None
        self.active = 0
        self.logging_out = False
        self.reauth_until = 0
        self.last_test = None

    async def close(self):
        await self.cancel()
        await self.http.aclose()

    def status(self):
        storage_error = None
        catalog_error = None
        try:
            credentials = self.store.load_credentials()
        except CodexAuthError as exc:
            credentials = None
            storage_error = exc.code
        try:
            cache = self.store.load_catalog_cache()
            snapshot = CatalogSnapshot.from_dict(cache) if cache else None
        except CodexAuthError as exc:
            snapshot = None
            catalog_error = exc.code
        if not credentials or not snapshot or snapshot.generation != credentials.generation or not snapshot.models_valid:
            snapshot = None
        return {
            'connection': 'connected' if credentials else 'error' if storage_error else 'disconnected',
            'storage_error': storage_error, 'catalog_error': catalog_error,
            'operation': {k: v for k, v in (self.operation or {}).items() if k in {'id','state','error','authorize_url','redirect_uri','deadline'}},
            'models': [m.to_dict() for m in snapshot.models] if snapshot else [],
            'catalog_source': snapshot.source if snapshot else None,
            'catalog_fetched_at': snapshot.fetched_at if snapshot else None,
            'reauth_required': self.reauth_until > self.clock(),
            'last_test': self.last_test,
        }

    async def start(self):
        async with self.operation_lock:
            if self.active or self.logging_out:
                raise CodexAuthError('operation_in_progress', '请先停止生成或等待退出完成，再登录。', 409)
            if self.operation and self.operation['state'] in {'waiting','exchanging','fetching_models'}:
                return self.status()
            pkce = generate_pkce()
            state = secrets.token_urlsafe(32)
            callback = await LoopbackCallback.start(expected_state=state, ports=CODEX_CALLBACK_PORTS)
            uri = f'http://localhost:{callback.port}{CODEX_CALLBACK_PATH}'
            operation = {'id': secrets.token_urlsafe(24), 'state': 'waiting', 'secret': state,
                         'pkce': pkce, 'callback': callback, 'redirect_uri': uri,
                         'authorize_url': build_authorize_url(redirect_uri=uri, state=state, pkce=pkce),
                         'deadline': self.clock() + CODEX_LOGIN_TIMEOUT_SECONDS,
                         'generation': self.store.current_generation()}
            self.operation = operation
            operation['task'] = asyncio.create_task(self._login(operation))
            return self.status()

    async def _login(self, op):
        try:
            callback = await op['callback'].wait(max(0, op['deadline'] - self.clock()))
            if not oauth_state_matches(callback.state, op['secret']) or callback.error or not callback.code:
                raise CodexAuthError('invalid_callback', '登录回调无效，请重新登录。')
            op['state'] = 'exchanging'
            payload = await self.oauth.exchange_code(callback.code, op['redirect_uri'], op['pkce'].verifier)
            credentials = self.credentials(payload, op['generation'])
            self.store.commit_credentials(credentials, op['generation'])
            self.reauth_until = 0
            self.last_test = None
            op['state'] = 'fetching_models'
            await self.refresh_models()
            op['state'] = 'completed'
        except asyncio.CancelledError:
            op['state'] = 'cancelled'
        except CodexAuthError as exc:
            op['state'] = 'expired' if exc.code == 'login_timeout' else 'failed'
            op['error'] = exc.code
        except Exception:
            op['state'] = 'failed'
            op['error'] = 'login_failed'

    async def complete(self, url):
        op = self.operation
        if not op or op['state'] != 'waiting':
            raise CodexAuthError('no_login', '没有等待中的登录。', 409)
        parsed, expected = urlsplit(url), urlsplit(op['redirect_uri'])
        if (parsed.scheme, parsed.hostname, parsed.port, parsed.path) != (expected.scheme, expected.hostname, expected.port, expected.path) or parsed.username or parsed.password or parsed.fragment:
            raise CodexAuthError('invalid_callback', '请粘贴本次登录完整的回调地址。')
        params = parse_qs(parsed.query)
        if len(params.get('state', [])) != 1 or len(params.get('code', [])) > 1 or len(params.get('error', [])) > 1:
            raise CodexAuthError('invalid_callback', '回调参数无效。')
        state = params.get('state', [''])[0]
        if not oauth_state_matches(state, op['secret']):
            raise CodexAuthError('invalid_state', '回调不属于本次登录。')
        from .oauth import OAuthCallbackResult
        op['callback'].submit(OAuthCallbackResult(params.get('code', [None])[0], state, params.get('error', [None])[0]))
        return self.status()

    async def cancel(self):
        op = self.operation
        if op and op.get('task') and not op['task'].done():
            op['task'].cancel()
            await asyncio.gather(op['task'], return_exceptions=True)
            op['state'] = 'cancelled'
            await op['callback'].cancel()
        return self.status()

    async def token(self):
        async with self.refresh_lock:
            credentials = self.store.load_credentials()
            if not credentials:
                raise CodexAuthError('authentication_required', '请先登录 Codex。', 401)
            if self.reauth_until > self.clock():
                raise CodexAuthError('authentication_required', '登录已失效，请重新登录。', 401)
            if credentials.expires_at - self.clock() > 300:
                return credentials
            return await self._refresh(credentials)

    async def _refresh(self, old):
        try:
            payload = await self.oauth.refresh(old.refresh_token)
        except CodexAuthError as exc:
            if exc.code == 'token_refresh_rejected':
                self.reauth_until = self.clock() + 60
            raise
        updated = self.credentials(payload, old.generation, old)
        if updated.account_id != old.account_id:
            raise CodexAuthError('account_changed', '刷新返回了不同账号，请重新登录。', 409)
        committed = self.store.commit_credentials(updated, old.generation)
        self.reauth_until = 0
        return committed

    async def recover(self, generation):
        async with self.refresh_lock:
            old = self.store.load_credentials()
            if old and old.generation == generation:
                await self._refresh(old)

    async def refresh_models(self):
        credentials = await self.token()
        await self.catalog.get(credentials, force=True)
        return self.status()

    async def logout(self):
        if self.active:
            raise CodexAuthError('inference_in_progress', '请先停止当前生成，再退出登录。', 409)
        self.logging_out = True
        try:
            await self.cancel()
            old = self.store.load_credentials()
            # Invalidate locally before awaiting revoke: late requests cannot resurrect this session.
            self.store.clear_credentials()
            if old:
                try:
                    await self.oauth.revoke(old)
                except Exception:
                    pass
            self.operation = None
            self.last_test = None
            self.reauth_until = 0
            return self.status()
        finally:
            self.logging_out = False

    def credentials(
        self,
        payload: dict[str, Any],
        expected_generation: int,
        fallback: CodexCredentials | None = None,
    ) -> CodexCredentials:
        access_token = self._required_token(
            payload.get("access_token"),
            fallback.access_token if fallback is not None else None,
        )
        refresh_token = self._required_token(
            payload.get("refresh_token"),
            fallback.refresh_token if fallback is not None else None,
        )
        id_token = self._required_token(
            payload.get("id_token"),
            fallback.id_token if fallback is not None else None,
        )

        account_id = self._first_nonempty_string(
            payload.get("account_id"),
            payload.get("chatgpt_account_id"),
        )
        expires_at = self._positive_int(payload.get("expires_at"))
        for token in (id_token, access_token):
            if account_id is not None and expires_at is not None:
                break
            try:
                claims = decode_codex_jwt(token)
            except CodexAuthError:
                continue
            account_id = account_id or claims.account_id
            expires_at = expires_at or claims.expires_at

        if account_id is None and fallback is not None:
            account_id = fallback.account_id
        if expires_at is None:
            expires_in = self._positive_int(payload.get("expires_in"))
            if expires_in is not None:
                expires_at = int(self.clock()) + expires_in
        if expires_at is None and fallback is not None:
            expires_at = fallback.expires_at
        if account_id is None or expires_at is None:
            raise CodexAuthError(
                "token_response_invalid",
                "Codex returned incomplete authentication data.",
                502,
            )

        return CodexCredentials(
            schema_version=1,
            access_token=access_token,
            refresh_token=refresh_token,
            id_token=id_token,
            account_id=account_id,
            expires_at=expires_at,
            generation=expected_generation,
        )

    @staticmethod
    def _required_token(value: object, fallback: str | None) -> str:
        if isinstance(value, str) and value:
            return value
        if fallback:
            return fallback
        raise CodexAuthError(
            "token_response_invalid",
            "Codex returned incomplete authentication data.",
            502,
        )

    @staticmethod
    def _first_nonempty_string(*values: object) -> str | None:
        for value in values:
            if isinstance(value, str) and value:
                return value
        return None

    @staticmethod
    def _positive_int(value: object) -> int | None:
        if isinstance(value, bool) or not isinstance(value, int) or value <= 0:
            return None
        return value

