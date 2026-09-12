// fromScan needs no fonts, so it can run in plain node by evaluating label.js with stub globals.
const fs=require('fs'),vm=require('vm');
const ctx={window:{},qrcode:function(){},opentype:{parse:function(){throw new Error('stub');}},polygonClipping:{},FONT_B64:{},MARK_PATH:"",FRAME:{_art:{x:0,y:0,w:1,h:1},corner:{box:[0,0,0,0]},edgeMid:{box:[0,0,0,0]},divider:{box:[0,0,0,0]}}};
ctx.window=ctx;vm.createContext(ctx);
vm.runInContext(fs.readFileSync('public/slab/label.js','utf8'),ctx);
const f=ctx.SlabLabel.fromScan;
const row={card_name:"Pikachu V",card_set:"2024 Pokémon x SpongeBob",card_number:"001",card_game:"pokemon",card_info:{rarity:"Special Illustration Rare",variant:"Bikini Bottom Promo"},grade_value:10,grade_label:"Pristine (Black Label)"};
const out=f(row,"SS26-00001");
const expect={name:"PIKACHU V",l2:"2024 POKÉMON X SPONGEBOB",l3:"BIKINI BOTTOM PROMO #001",l4:"SPECIAL ILLUSTRATION RARE",cert:"SS26-00001",grade:"10",gradeWord:"PRISTINE"};
let bad=0;for(const k in expect)if(out[k]!==expect[k]){console.log('MISMATCH',k,JSON.stringify(out[k]),'expected',JSON.stringify(expect[k]));bad++;}
const half=f({card_name:"x",grade_value:8.5,grade_label:"NM-MT+",card_game:"mtg"},"SS26-00002");
if(half.grade!=="8.5"||half.gradeWord!=="NM-MT+"||half.l2!=="MAGIC"){console.log('MISMATCH half-grade/mtg',half);bad++;}
console.log(bad?'FAIL':'PASS');process.exit(bad?1:0);
