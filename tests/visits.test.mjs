import test from 'node:test';
import assert from 'node:assert/strict';
import { validateVisits } from '../visits.js';
const visit = () => ({id:'test-visit',at:new Date('2026-11-01T10:00:00+09:00').getTime(),hospital:' 测试医院 ',summary:'示例说明',followup:'2026-11-30',cost:'1200'});
test('old journals without visit data default to an empty list',()=>assert.deepEqual(validateVisits(),[]));
test('visit fields normalize and retain notes, hospital, cost and followup',()=>{const result=validateVisits([visit()])[0];assert.equal(result.hospital,'测试医院');assert.equal(result.cost,'1200');assert.equal(result.summary,'示例说明');assert.equal(result.followup,'2026-11-30');assert.equal(result.notes,'');});
test('reject duplicate IDs and invalid dates',()=>{assert.throws(()=>validateVisits([visit(),visit()]));assert.throws(()=>validateVisits([{...visit(),followup:'2026-02-30'}]));assert.throws(()=>validateVisits([{...visit(),at:Infinity}]));});
test('reject malformed and oversized fields',()=>{assert.throws(()=>validateVisits([{...visit(),hospital:''}]));assert.throws(()=>validateVisits([{...visit(),notes:'a'.repeat(3001)}]));assert.throws(()=>validateVisits([{...visit(),doctor:{name:'x'}}]));});
test('reject negative and nonnumeric costs without coercing values',()=>{assert.throws(()=>validateVisits([{...visit(),cost:'-20'}]));assert.throws(()=>validateVisits([{...visit(),cost:'NaN'}]));assert.throws(()=>validateVisits([{...visit(),cost:1200}]));});
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const app = readFileSync(new URL('../app.js',import.meta.url),'utf8');
function journalContext(state) {
  const context = vm.createContext({validateVisits, fixtureState:state, structuredClone});
  const constants=app.slice(app.indexOf('const medicineTypes'),app.indexOf('let calendarMedicineId'));
  const validation=app.slice(app.indexOf('function validate(records)'),app.indexOf('function loadState()'));
  const merging=app.slice(app.indexOf('async function mergeBackup('),app.indexOf('let refreshing'));
  vm.runInContext(constants+'\n'+validation+'\n'+merging+'\nasync function update(change) { fixtureState=checkedState(change(fixtureState)); return true; }',context);
  return context;
}
test('adding visits and normalization preserve existing medication IDs, times and doses',()=>{
 const data={medicines:[{id:'original-med',name:'旧药',kind:'oral',icon:'🟡'}],records:[{id:'original-record',at:12345,medicineId:'original-med',quantity:3}],visits:[visit()]};
 const ctx=journalContext(data);const normalized=JSON.parse(vm.runInContext('JSON.stringify(checkedState(fixtureState))',ctx));
 assert.deepEqual(normalized.records,data.records);assert.equal(normalized.medicines[0].icon,'🟡');assert.equal(normalized.visits[0].id,visit().id);
});
test('importing an older medication-only backup preserves and deduplicates visits',async()=>{
 const ctx=journalContext({medicines:[],records:[],visits:validateVisits([visit()])});
 await vm.runInContext('mergeBackup([{id:"legacy",at:123}],[],null)',ctx);
 await vm.runInContext('mergeBackup([{id:"legacy",at:123}],[],null,fixtureState.visits)',ctx);
 const saved=JSON.parse(vm.runInContext('JSON.stringify(fixtureState)',ctx));assert.equal(saved.visits.length,1);assert.equal(saved.records.length,1);
});
import { buildVisitEvents } from '../visits.js';
test('appointments remain separate from completed records, including overdue ones',()=>{
 const old=visit();const planned={...visit(),id:'planned',status:'scheduled',at:1,followup:''};
 const result=buildVisitEvents([old,planned]);assert.equal(result.completed.length,1);assert.equal(result.appointments.length,2);assert.ok(result.appointments.some(v=>v.id==='planned'));
});
test('legacy followup becomes a date-only calendar appointment without copying old diagnosis',()=>{
 const result=buildVisitEvents([visit()]);const appointment=result.appointments[0];assert.equal(appointment.sourceId,'test-visit');assert.equal(appointment.status,'scheduled');assert.equal(appointment.dateOnly,true);assert.equal(appointment.summary,'');assert.equal(appointment.cost,'');assert.equal(result.completed[0].summary,'示例说明');
});
test('recording a followup consumes the pending appointment without removing original visit',()=>{
 const original=visit();const followup={...visit(),id:'next-visit',followup:'',followupOf:original.id,status:'completed'};
 const result=buildVisitEvents([original,followup]);assert.equal(result.completed.length,2);assert.equal(result.appointments.length,0);
});
test('invalid appointment statuses are rejected and legacy visits default to completed',()=>{
 assert.equal(validateVisits([visit()])[0].status,'completed');assert.throws(()=>validateVisits([{...visit(),status:'unknown'}]));
});
import { appointmentTiming } from '../visits.js';
test('reminder switches at appointment time without changing its status',()=>{
 const now=Date.now();const appointment={...visit(),status:'scheduled',at:now+1000};
 assert.equal(appointmentTiming(appointment,now),'upcoming');assert.equal(appointmentTiming(appointment,now+1000),'due');assert.equal(appointmentTiming(appointment,now+62000),'overdue');assert.equal(appointment.status,'scheduled');
});
test('date-only followups remind by local date rather than an invented appointment time',()=>{
 const now=new Date(2026,10,8,1).getTime();const appointment={status:'scheduled',at:new Date(2026,10,8,9).getTime(),dateOnly:true};
 assert.equal(appointmentTiming(appointment,now),'due');assert.equal(appointmentTiming(appointment,new Date(2026,10,9,1).getTime()),'overdue');
});
test('cancelled appointments are retained and never counted as completed',()=>{
 const cancelled={...visit(),status:'cancelled',id:'cancelled',followup:''};const result=buildVisitEvents(validateVisits([cancelled]));assert.equal(result.completed.length,0);assert.equal(result.appointments.length,0);assert.equal(result.cancelled.length,1);assert.equal(result.cancelled[0].hospital,'测试医院');
});
test('cancelling a legacy followup preserves its original visit and followup date',()=>{
 const original={...visit(),followupCancelled:true};const saved=validateVisits([original]);const result=buildVisitEvents(saved);assert.equal(result.completed.length,1);assert.equal(result.appointments.length,0);assert.equal(result.completed[0].followup,'2026-11-30');
});
