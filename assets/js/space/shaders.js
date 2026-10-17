// GLSL for the planets, clouds, atmospheres, sun and nebula.

// Ashima 3D simplex noise + fbm
const NOISE = /* glsl */ `
vec3 mod289(vec3 x){return x-floor(x*(1.0/289.0))*289.0;}
vec4 mod289(vec4 x){return x-floor(x*(1.0/289.0))*289.0;}
vec4 permute(vec4 x){return mod289(((x*34.0)+10.0)*x);}
vec4 taylorInvSqrt(vec4 r){return 1.79284291400159-0.85373472095314*r;}
float snoise(vec3 v){
  const vec2 C=vec2(1.0/6.0,1.0/3.0);
  const vec4 D=vec4(0.0,0.5,1.0,2.0);
  vec3 i=floor(v+dot(v,C.yyy));
  vec3 x0=v-i+dot(i,C.xxx);
  vec3 g=step(x0.yzx,x0.xyz);
  vec3 l=1.0-g;
  vec3 i1=min(g.xyz,l.zxy);
  vec3 i2=max(g.xyz,l.zxy);
  vec3 x1=x0-i1+C.xxx;
  vec3 x2=x0-i2+C.yyy;
  vec3 x3=x0-D.yyy;
  i=mod289(i);
  vec4 p=permute(permute(permute(i.z+vec4(0.0,i1.z,i2.z,1.0))+i.y+vec4(0.0,i1.y,i2.y,1.0))+i.x+vec4(0.0,i1.x,i2.x,1.0));
  float n_=0.142857142857;
  vec3 ns=n_*D.wyz-D.xzx;
  vec4 j=p-49.0*floor(p*ns.z*ns.z);
  vec4 x_=floor(j*ns.z);
  vec4 y_=floor(j-7.0*x_);
  vec4 x=x_*ns.x+ns.yyyy;
  vec4 y=y_*ns.x+ns.yyyy;
  vec4 h=1.0-abs(x)-abs(y);
  vec4 b0=vec4(x.xy,y.xy);
  vec4 b1=vec4(x.zw,y.zw);
  vec4 s0=floor(b0)*2.0+1.0;
  vec4 s1=floor(b1)*2.0+1.0;
  vec4 sh=-step(h,vec4(0.0));
  vec4 a0=b0.xzyw+s0.xzyw*sh.xxyy;
  vec4 a1=b1.xzyw+s1.xzyw*sh.zzww;
  vec3 p0=vec3(a0.xy,h.x);
  vec3 p1=vec3(a0.zw,h.y);
  vec3 p2=vec3(a1.xy,h.z);
  vec3 p3=vec3(a1.zw,h.w);
  vec4 norm=taylorInvSqrt(vec4(dot(p0,p0),dot(p1,p1),dot(p2,p2),dot(p3,p3)));
  p0*=norm.x;p1*=norm.y;p2*=norm.z;p3*=norm.w;
  vec4 m=max(0.5-vec4(dot(x0,x0),dot(x1,x1),dot(x2,x2),dot(x3,x3)),0.0);
  m=m*m;
  return 105.0*dot(m*m,vec4(dot(p0,x0),dot(p1,x1),dot(p2,x2),dot(p3,x3)));
}
float fbm(vec3 p){
  float a=0.5, s=0.0;
  for(int i=0;i<5;i++){ s+=a*snoise(p); p=p*2.03+vec3(1.7,9.2,3.1); a*=0.5; }
  return s;
}
`;

const SPHERE_VERT = /* glsl */ `
varying vec3 vObj;
varying vec3 vNormalW;
varying vec3 vPosW;
void main(){
  vObj = normalize(position);
  vNormalW = normalize(mat3(modelMatrix) * normal);
  vec4 w = modelMatrix * vec4(position, 1.0);
  vPosW = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}
`;

export const MAX_CONTINENTS = 8;

export const planetShader = {
  vertexShader: SPHERE_VERT,
  fragmentShader: /* glsl */ `
#define MAXC ${MAX_CONTINENTS}
uniform vec3 uCenters[MAXC];
uniform float uRadii[MAXC];
uniform vec3 uColors[MAXC];
uniform int uCount;
uniform int uActive;
uniform int uHover;
uniform vec3 uOcean;
uniform vec3 uOceanDeep;
uniform vec3 uSunPos;
uniform vec3 uGlow;
uniform float uSeed;
uniform float uTime;
varying vec3 vObj;
varying vec3 vNormalW;
varying vec3 vPosW;
${NOISE}
void main(){
  vec3 n = normalize(vObj);
  float warp = fbm(n * 2.2 + uSeed) * 0.45 + snoise(n * 9.0 + uSeed) * 0.06;

  int best = -1;
  float bestM = -10.0;
  float secondM = -10.0;
  for (int i = 0; i < MAXC; i++) {
    if (i >= uCount) break;
    float a = acos(clamp(dot(n, uCenters[i]), -1.0, 1.0));
    float m = uRadii[i] * (1.0 + warp) - a;
    if (m > bestM) { secondM = bestM; bestM = m; best = i; }
    else if (m > secondM) { secondM = m; }
  }
  // Keep a sea channel between neighbouring continents
  bestM = min(bestM, (bestM - secondM) * 0.5 - 0.05);

  float land = smoothstep(0.0, 0.012, bestM);
  float shore = smoothstep(-0.05, 0.0, bestM) * (1.0 - land);

  // Ocean
  float o = fbm(n * 5.0 + uSeed * 2.0);
  vec3 ocean = mix(uOceanDeep, uOcean, clamp(0.55 + o * 0.6 + shore * 0.8, 0.0, 1.0));

  // Land: base biome color, relief, high peaks
  vec3 base = vec3(0.5);
  for (int i = 0; i < MAXC; i++) { if (i == best) base = uColors[i]; }
  float h = fbm(n * 14.0 + uSeed * 3.0);
  float inland = smoothstep(0.0, 0.25, bestM);
  vec3 ground = base * (0.72 + 0.55 * h);
  ground = mix(ground * 1.15 + 0.05, ground, smoothstep(0.0, 0.03, bestM));
  ground = mix(ground, vec3(0.93, 0.95, 1.0), smoothstep(0.55, 0.85, h * 0.8 + inland * 0.45) * 0.5);

  vec3 albedo = mix(ocean, ground, land);

  // Lighting
  vec3 N = normalize(vNormalW);
  vec3 L = normalize(uSunPos - vPosW);
  vec3 V = normalize(cameraPosition - vPosW);
  float diff = max(dot(N, L), 0.0);
  float spec = pow(max(dot(N, normalize(L + V)), 0.0), 60.0) * (1.0 - land) * 0.6;
  vec3 col = albedo * (0.07 + diff * 1.05) + spec * vec3(1.0, 0.95, 0.85);

  // City lights on the night side
  float night = 1.0 - smoothstep(-0.1, 0.15, dot(N, L));
  float cities = smoothstep(0.6, 0.85, snoise(n * 45.0 + uSeed)) * land * inland;
  col += night * cities * vec3(1.0, 0.75, 0.4) * 0.9;

  // Highlight the selected / hovered continent
  if (best == uActive && land > 0.0) {
    float pulse = 0.5 + 0.5 * sin(uTime * 2.5);
    col += uGlow * (0.08 + 0.05 * pulse) * land;
  }
  if (best == uHover && best != uActive) col += vec3(0.06) * land;
  float edge = 1.0 - smoothstep(0.0, 0.012, abs(bestM - 0.006));
  if (best == uActive) col = mix(col, uGlow * 1.4, edge * 0.85);

  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}
`,
};

export const cloudShader = {
  vertexShader: SPHERE_VERT,
  fragmentShader: /* glsl */ `
uniform vec3 uSunPos;
uniform float uSeed;
uniform float uTime;
uniform float uDensity;
varying vec3 vObj;
varying vec3 vNormalW;
varying vec3 vPosW;
${NOISE}
void main(){
  vec3 n = normalize(vObj);
  float c = fbm(n * 3.0 + vec3(uTime * 0.01, 0.0, uSeed));
  float a = smoothstep(0.1, 0.55, c + uDensity) * 0.75;
  vec3 N = normalize(vNormalW);
  float diff = max(dot(N, normalize(uSunPos - vPosW)), 0.0);
  gl_FragColor = vec4(vec3(1.0) * (0.05 + diff), a * (0.15 + diff));
}
`,
};

export const atmosphereShader = {
  vertexShader: SPHERE_VERT,
  fragmentShader: /* glsl */ `
uniform vec3 uColor;
uniform vec3 uSunPos;
varying vec3 vNormalW;
varying vec3 vPosW;
void main(){
  vec3 N = normalize(vNormalW);
  vec3 V = normalize(cameraPosition - vPosW);
  float rim = pow(1.0 - abs(dot(N, V)), 2.5);
  float lit = clamp(dot(N, normalize(uSunPos - vPosW)) + 0.35, 0.0, 1.0);
  gl_FragColor = vec4(uColor * rim * lit * 1.6, rim * lit);
}
`,
};

export const sunShader = {
  vertexShader: SPHERE_VERT,
  fragmentShader: /* glsl */ `
uniform float uTime;
varying vec3 vObj;
varying vec3 vNormalW;
varying vec3 vPosW;
${NOISE}
void main(){
  vec3 n = normalize(vObj);
  float f = fbm(n * 4.0 + vec3(0.0, uTime * 0.05, 0.0));
  float g = snoise(n * 18.0 - uTime * 0.1);
  vec3 col = mix(vec3(1.0, 0.45, 0.1), vec3(1.0, 0.92, 0.6), clamp(0.55 + f * 0.8 + g * 0.1, 0.0, 1.0));
  vec3 V = normalize(cameraPosition - vPosW);
  float limb = pow(max(dot(normalize(vNormalW), V), 0.0), 0.35);
  gl_FragColor = vec4(col * (0.7 + 0.6 * limb), 1.0);
  #include <colorspace_fragment>
}
`,
};

export const nebulaShader = {
  vertexShader: /* glsl */ `
varying vec3 vDir;
void main(){
  vDir = normalize(position);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`,
  fragmentShader: /* glsl */ `
varying vec3 vDir;
${NOISE}
void main(){
  vec3 d = normalize(vDir);
  float a = fbm(d * 2.0);
  float b = fbm(d * 3.5 + 7.0);
  vec3 col = vec3(0.0);
  col += vec3(0.35, 0.12, 0.55) * smoothstep(0.1, 0.8, a) * 0.16;
  col += vec3(0.05, 0.35, 0.55) * smoothstep(0.2, 0.9, b) * 0.12;
  col += vec3(0.6, 0.25, 0.1) * smoothstep(0.35, 0.9, a * b * 2.0) * 0.08;
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}
`,
};
