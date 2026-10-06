export function redactEvidence(value:unknown,secretValues:readonly string[]=[]):unknown{
 if(Array.isArray(value))return value.map(v=>redactEvidence(v,secretValues));
 if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,/token|secret|password|credential|(^|_)sek($|_)|appkey|authorization/i.test(k)?'[REDACTED]':redactEvidence(v,secretValues)]));
 if(typeof value==='string'&&(/password|secret|auth.?token|authorization|session.?key/i.test(value)||secretValues.some(s=>s.length&&value.includes(s))))return '[REDACTED]';return value;
}
