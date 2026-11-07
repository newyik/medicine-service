import test from 'node:test';
import assert from 'node:assert/strict';
import { emailAuthMessage, validateEmailPassword } from '../email-auth.js';
test('password setup rejects mismatches and short passwords',()=>{
 assert.ok(validateEmailPassword('123','123'));assert.ok(validateEmailPassword('a-long-demo','a-wrong-demo'));assert.equal(validateEmailPassword('a-long-demo','a-long-demo'),'');
});
test('unknown backend errors never echo raw credential or token text',()=>{
 const result=emailAuthMessage({message:'secret-access-token-example'});assert.ok(!result.includes('secret-access-token-example'));assert.ok(result.includes('GitHub'));
});
test('invalid credentials explain how existing GitHub accounts keep their records',()=>{
 assert.ok(emailAuthMessage({code:'invalid_credentials'}).includes('GitHub'));assert.ok(emailAuthMessage({code:'reauthentication_needed'}).includes('重新'));
});
