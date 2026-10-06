import {spawn} from 'node:child_process';
import {emailBrowserFixture} from './email-fixture.mjs';
const f=await emailBrowserFixture();
try{await new Promise((resolve,reject)=>{const child=spawn(process.execPath,['e2e/walkthrough.mjs'],{cwd:new URL('../',import.meta.url).pathname,env:{...process.env,WEB_URL:f.web,CHROMIUM_PATH:process.env.CHROMIUM_PATH??'/usr/bin/chromium',SHOTS_DIR:'/tmp/email-legacy-shots'},stdio:'inherit'});child.on('error',reject);child.on('exit',code=>code===0?resolve():reject(new Error('Legacy browser failed')));});}finally{await f.close();}
