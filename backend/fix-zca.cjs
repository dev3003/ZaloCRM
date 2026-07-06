const fs = require('fs');

function patchFile(path) {
  if (!fs.existsSync(path)) return;
  let code = fs.readFileSync(path, 'utf8');
  
  // Replace string back to original structure but with INT__ prefix
  code = code.replace(/gMsgID: dest\.data\.msgId,/g, 'gMsgID: "INT__" + dest.data.msgId,');
  code = code.replace(/cMsgID: dest\.data\.cliMsgId,/g, 'cMsgID: "INT__" + (dest.data.cliMsgId || Date.now()),');
  
  // Apply regex to JSON.stringify
  code = code.replace(/message: JSON\.stringify\(([\s\S]*?)\),\n\s*clientId/m, 
    'message: JSON.stringify($1).replace(/"INT__(\\d+)"/g, "$1"),\n                    clientId');
    
  fs.writeFileSync(path, code);
  console.log("Patched " + path);
}

patchFile('node_modules/zca-js/dist/apis/addReaction.js');
patchFile('node_modules/zca-js/dist/cjs/apis/addReaction.cjs');

