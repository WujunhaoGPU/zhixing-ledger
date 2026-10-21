import assert from "node:assert/strict";
import { createTraining, trainingMessages, validateTrainingSettlement } from "../src/ability-ledger-extension/shared/codexTraining.js";
import { CodexClient, CODEX_CONNECTION_KEY } from "../src/ability-ledger-extension/shared/codexClient.js";
import { createEmptyState, normalizeState, normalizeSkillCard, buildMarkdownExport } from "../src/ability-ledger-extension/shared/ledgerModel.js";
const card = normalizeSkillCard({ id: "card-1", name: "反向思维", oneLine: "从失败反推行动", levelEvents: [{type:"capture",targetLevel:"L0"}] });
const session = createTraining(card, "model-a");
assert(!trainingMessages(session, card).at(-1).content.includes("参考答案"));
session.firstAnswer = "我会先列失败原因，再反推行动。";
session.secondAnswer = "我会列失败原因，转成检查项，但还没有实际执行。";
session.feedback = "要区分计划和已执行的行动。";
const payload = { schemaVersion:3, session:{topic:card.name,recallScore:2,kind:"recall",status:"完成"}, cards:[{
  name:card.name,oneLine:card.oneLine,contentBlocks:[{type:"first_recall",text:"虚构回答"}],levelEvents:[
    {type:"application",targetLevel:"L3",userEvidence:session.secondAnswer},
    {type:"recall",targetLevel:"L2",recallScore:2,userEvidence:session.firstAnswer},
    {type:"transfer",targetLevel:"L4",userEvidence:session.secondAnswer},
    {type:"understanding",targetLevel:"L1",userEvidence:"模型编造的引文"}
  ]}] };
const checked = validateTrainingSettlement(session, card, JSON.stringify(payload));
assert.equal(checked.update.skillCards[0].level, "L2");
assert.equal(checked.update.skillCards[0].contentBlocks.find(b=>b.type==="first_recall").text,session.firstAnswer);
assert.equal(checked.update.skillCards[0].contentBlocks.find(b=>b.type==="feedback").text,session.feedback);
assert.throws(()=>validateTrainingSettlement({...session,secondAnswer:""},card,JSON.stringify(payload)));
assert.throws(()=>validateTrainingSettlement(session,card,JSON.stringify({...payload,cards:[{...payload.cards[0],name:"别的主题"}]})));
const realSession = { ...session, evidenceMode: "real-application", applicationAction: "模拟面试", applicationResult: "发现三个回答缺口" };
const application = { ...payload, cards: [{ ...payload.cards[0], levelEvents: [{ type: "application", targetLevel: "L3", userEvidence: session.firstAnswer }] }] };
assert.equal(validateTrainingSettlement(realSession, card, JSON.stringify(application)).update.skillCards[0].level, "L3");
assert.equal(validateTrainingSettlement({ ...realSession, applicationResult: "" }, card, JSON.stringify(application)).update.skillCards[0].level, "L0");
assert(trainingMessages({ ...realSession, phase: "question" }, card).at(-1).content.includes("真实应用"));
const multiline = { ...realSession, firstAnswer: session.firstAnswer + "\n实际行动：已经执行\n结果：发现缺口" };
const multilinePayload = { ...application, cards: [{ ...application.cards[0], levelEvents: [{ type: "application", targetLevel: "L3", userEvidence: multiline.firstAnswer }] }] };
assert.equal(validateTrainingSettlement(multiline, card, JSON.stringify(multilinePayload)).update.skillCards[0].level, "L3");
const state = normalizeState({...createEmptyState(),trainingSessions:[{...session,busy:true,access_token:"do-not-export"}]});
assert.equal(state.trainingSessions[0].busy,false);
assert(!JSON.stringify(state).includes("do-not-export"));
assert(buildMarkdownExport(state).includes("知行簿训练记录"));
const storage = { async get(){ return { [CODEX_CONNECTION_KEY]: {token:"local-pair-token"} }; } };
const stream = events => new Response(events.map(e=>JSON.stringify(e)+"\n").join(""));
let lastOptions;
const client = new CodexClient(storage, async (url, options) => { lastOptions = options; return stream([{type:"delta",text:"中"},{type:"completed",text:"中文",usage:{}}]); });
assert.equal((await client.generate([{role:"user",content:"test"}],"model")).text,"中文");
assert.equal(lastOptions.headers.Authorization,"Bearer local-pair-token");
const partial = new CodexClient(storage,async()=>stream([{type:"delta",text:"partial"}]));
await assert.rejects(()=>partial.generate([{role:"user",content:"test"}],"model"),/提前结束/);
const failure = new CodexClient(storage,async()=>stream([{type:"error",message:"额度限制"}]));
await assert.rejects(()=>failure.generate([{role:"user",content:"test"}],"model"),/额度限制/);
console.log("Codex training/client contracts passed.");
