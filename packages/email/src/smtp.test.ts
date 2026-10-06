import {expect,it} from 'vitest';
import {classifySmtpError} from './smtp.js';
it('treats generic connection loss as unknown even when the command field is unavailable',()=>{expect(classifySmtpError({code:'ECONNECTION',response:'private raw link'})).toEqual({kind:'unknown',code:'transport_unknown'});});
it('retries explicit temporary refusal and proven refusal before connection',()=>{expect(classifySmtpError({responseCode:450,response:'private'})).toEqual({kind:'temporary',code:'temporary_refusal'});expect(classifySmtpError({code:'ESOCKET',errno:'ECONNREFUSED'})).toEqual({kind:'temporary',code:'transport_timeout'});});
it('stops recipient and authentication refusal without preserving provider text',()=>{expect(classifySmtpError({responseCode:550,response:'recipient@example.test'})).toEqual({kind:'permanent',code:'recipient_refused'});expect(classifySmtpError({code:'EAUTH',response:'credential'})).toEqual({kind:'permanent',code:'auth_refused'});});
