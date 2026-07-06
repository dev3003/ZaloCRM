const fs = require('fs');

function patchFile(path) {
  if (!fs.existsSync(path)) return;
  let code = fs.readFileSync(path, 'utf8');
  
  // Find the JSON.stringify call for reaction message
  // It looks like: message: JSON.stringify({ rMsg: [ { gMsgID: ..., cMsgID: ... } ] })
  
  // Replace the old parseInt logic completely with our robust regex replacer
  const oldStr1 = 'gMsgID: dest.data.msgId,';
  const oldStr2 = 'cMsgID: dest.data.cliMsgId,';
  
  const newStr1 = 'gMsgID: "INT__" + dest.data.msgId,';
  const newStr2 = 'cMsgID: "INT__" + (dest.data.cliMsgId || Date.now()),';
  
  code = code.replace(oldStr1, newStr1).replace(oldStr2, newStr2);
  
  // Now find where it does JSON.stringify(...) and replace it with JSON.stringify(...).replace(/"INT__(\d+)"/g, "$1")
  // The line is: message: JSON.stringify({
  // We can just find `clientId: Date.now(),` which is right after the message property.
  // Actually, better:
  code = code.replace(/message: JSON\.stringify\(([\s\S]*?)\),\n\s*clientId: Date.now\(\),/m, 
    'message: JSON.stringify($1).replace(/"INT__(\\d+)"/g, "$$1"),\n                    clientId: Date.now(),');
    
  fs.writeFileSync(path, code);
  console.log("Patched " + path);
}

patchFile('node_modules/zca-js/dist/apis/addReaction.js');
patchFile('node_modules/zca-js/dist/cjs/apis/addReaction.cjs');

