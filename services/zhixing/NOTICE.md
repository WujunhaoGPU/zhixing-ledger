# DeepTutor attribution

The files in codex_auth/ except service.py are copied (oauth.py changes only callback page branding) from HKUDS/DeepTutor commit a053fec (Apache-2.0). service.py adapts its login/refresh orchestration and credential conversion; provider.py adapts its Responses request shape. Original source: https://github.com/HKUDS/DeepTutor/tree/a053fec/deeptutor/services . See LICENSE.DeepTutor. Application routing, pairing and training integration are specific to 知行簿.
