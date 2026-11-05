import test from 'node:test';
import assert from 'node:assert/strict';
import { copyText } from '../src/clipboard.js';

function install(t, name, value) {
  const original = Object.getOwnPropertyDescriptor(globalThis, name);
  Object.defineProperty(globalThis, name, { configurable: true, value });
  t.after(() => original ? Object.defineProperty(globalThis, name, original) : delete globalThis[name]);
}

test('copies exact Unicode Markdown using the native clipboard', async (t) => {
  const writes=[];
  install(t,'navigator',{clipboard:{writeText:async(text)=>writes.push(text)}});
  await copyText('# DEMO-1\nÜberprüfung ✓\n');
  assert.deepEqual(writes,['# DEMO-1\nÜberprüfung ✓\n']);
});

test('empty input leaves the clipboard alone', async(t)=>{
  install(t,'navigator',{clipboard:{writeText:()=>assert.fail('unexpected copy')}});
  await assert.rejects(copyText('  '), /no Markdown/);
});

for(const outcome of [true,false,'throw']) {
  test(`fallback copy ${outcome} cleans up the field and restores focus`,async(t)=>{
    const denied=new Error('focus lost'); const calls=[]; const field={style:{},setAttribute(){},select(){calls.push('select')},remove(){calls.push('remove')}};
    install(t,'navigator',{clipboard:{writeText:async()=>{throw denied}}});
    install(t,'document',{
      activeElement:{focus(options){assert.deepEqual(options,{preventScroll:true});calls.push('focus')}},
      createElement(tag){assert.equal(tag,'textarea');return field},
      body:{append(el){assert.equal(el,field);calls.push('append')}},
      execCommand(command){assert.equal(command,'copy');assert.equal(field.value,'# Original text');if(outcome==='throw')throw new Error('command error');return outcome}
    });
    if(outcome===true) await copyText('# Original text');
    else await assert.rejects(copyText('# Original text'),outcome===false?denied:/command error/);
    assert.deepEqual(calls,['append','select','remove','focus']);
  });
}
