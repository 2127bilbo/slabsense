// scripts/plate-measure.cjs — finds the label window and the card well in the plate:
// the two largest fully-dark axis-aligned rectangles bounded by bright (acrylic) edges.
const {createCanvas,loadImage}=require('canvas');
loadImage('public/slab/plate-straight.png').then(im=>{
  const W=im.width,H=im.height,c=createCanvas(W,H),x=c.getContext('2d');x.drawImage(im,0,0);
  const d=x.getImageData(0,0,W,H).data, lum=(i)=>d[i*4]*0.3+d[i*4+1]*0.59+d[i*4+2]*0.11;
  const dark=new Uint8Array(W*H);for(let i=0;i<W*H;i++)dark[i]=lum(i)<40?1:0;
  // row profile along the plate's vertical centreline (cx) — dark runs separated by bright lines
  const cx=Math.round(W/2), runs=[];let start=-1;
  for(let y=0;y<H;y++){const isD=dark[y*W+cx];if(isD&&start<0)start=y;if(!isD&&start>=0){if(y-start>H*0.05)runs.push([start,y]);start=-1;}}
  if(start>=0&&H-start>H*0.05)runs.push([start,H]);
  // for each run, widen left/right along its middle row until a bright pixel
  const boxes=runs.map(([y0,y1])=>{const ym=Math.round((y0+y1)/2);let x0=cx,x1=cx;while(x0>0&&dark[ym*W+x0-1])x0--;while(x1<W-1&&dark[ym*W+x1+1])x1++;return {x:x0/W,y:y0/H,w:(x1-x0+1)/W,h:(y1-y0)/H,aspect:(x1-x0+1)/(y1-y0)};});
  console.log(JSON.stringify(boxes,null,1));
});
