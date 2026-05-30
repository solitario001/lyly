import * as THREE from './node_modules/three/build/three.module.js';
import { GLTFLoader } from './node_modules/three/examples/jsm/loaders/GLTFLoader.js';
import { OrbitControls } from './node_modules/three/examples/jsm/controls/OrbitControls.js';
import { VRMLoaderPlugin } from './node_modules/@pixiv/three-vrm/lib/three-vrm.module.js';
import { FBXLoader } from './node_modules/three/examples/jsm/loaders/FBXLoader.js';
import { AnimationMixer } from './node_modules/three/build/three.module.js';
import { VRMSpringBoneLoaderPlugin } from './node_modules/@pixiv/three-vrm/lib/three-vrm.module.js';





// 👄 CONFIGURAÇÃO DE LIP-SYNC (Deve ficar antes de qualquer classe que a use)
const LIP_SYNC_CONFIG = {
  attackSpeed: 12.0,          // Velocidade de abertura da boca
  releaseSpeed: 6.5,          // Velocidade de fechamento
  globalMultiplier: 1.0,      // Escalador geral
  closureThreshold: 0.52,     // Início do relaxamento nos últimos 15%
  minMouthOpenness: 0.02      // Abertura mínima durante o fade-out final
};



let bones = {}
let currentVrm = null



// 🧬 NOVO: Cache de meshes com blendshapes (descoberto uma vez após load)
let morphMeshes = []

let startTime = performance.now();

const idle = {
    time: 0
}

const armPose = {
    applied: false
}

const headSystem = {
    time: 0,

    // rotação atual
    current: { x: 0, y: 0 },

    // rotação alvo
    target: { x: 0, y: 0 },

    // controle
    timer: 0,
    interval: 2 + Math.random() * 3,

    // interpolação
    smooth: 0.04
}


const eyeSystem = {

    time: 0,

    // BLINK
    blinkTimer: 0,
    blinkInterval: 3 + Math.random() * 4,
    blinkDuration: 0.12,
    blinkProgress: 0,
    blinking: false,

    // SACCADE (micro movimento)
    saccadeTimer: 0,
    saccadeInterval: 0.5 + Math.random() * 1.5,

    offset: { x: 0, y: 0 },
    targetOffset: { x: 0, y: 0 },

    smooth: 0.15
}

const focusSystem = {
    timer: 0,
    interval: 2 + Math.random() * 4,

    target: { x: 0, y: 0 },

    holdTime: 0,
    holding: false
}



// Adicione o parâmetro alpha: true
const renderer = new THREE.WebGLRenderer({
    antialias: true,
    alpha: true,
    powerPreference: "high-performance",
    
});



// 🦾 IK Constraints (VRM usa radianos)
const ARM_IK_CONSTRAINTS = {
  upper: {
    upper: THREE.MathUtils.degToRad(90),
    lower: THREE.MathUtils.degToRad(-90),
    left: THREE.MathUtils.degToRad(90),
    right: THREE.MathUtils.degToRad(-90)
  },
  lower: {
    upper: THREE.MathUtils.degToRad(90),
    lower: THREE.MathUtils.degToRad(-90),
    left: THREE.MathUtils.degToRad(90),
    right: THREE.MathUtils.degToRad(-90)
  }
};



// Estado do IK (separado da ação de update)
const ikSystem = {
  target: new THREE.Vector3(),
  currentTarget: new THREE.Vector3(),
  enabled: true,
  lerpSpeed: 8.0
};

// Mouse Tracker para teste
const mouse = new THREE.Vector2();
const raycaster = new THREE.Raycaster();

function onMouseMove(event) {
  if (!currentVrm || !bones.rightUpperArm) return;

  mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
  mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;

  raycaster.setFromCamera(mouse, camera);

  // Plano fixo na frente do avatar para interceptação estável
  const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 2.0);
  const intersectPoint = new THREE.Vector3();

  if (raycaster.ray.intersectPlane(plane, intersectPoint)) {
    // Clamp RELATIVO à posição do ombro para evitar distorção em bordas/extremos da tela
    const shoulderPos = new THREE.Vector3();
    bones.rightUpperArm.getWorldPosition(shoulderPos);

    ikSystem.target.x = THREE.MathUtils.clamp(intersectPoint.x, shoulderPos.x - 1.0, shoulderPos.x + 1.0);
    ikSystem.target.y = THREE.MathUtils.clamp(intersectPoint.y, shoulderPos.y - 0.3, shoulderPos.y + 1.2);
    ikSystem.target.z = THREE.MathUtils.clamp(intersectPoint.z, shoulderPos.z + 0.2, shoulderPos.z + 2.0);
  }
}

// ✅ Vincula o evento (único listener ativo)
window.addEventListener('mousemove', onMouseMove);




THREE.ColorManagement.enabled = true;

renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(window.devicePixelRatio);

renderer.setClearColor(0x000000, 0); // <--- Garante que a cor de limpeza seja transparente
// Isso aqui é o segredo para 4K ficar nítido:

renderer.outputColorSpace = THREE.SRGBColorSpace; 

renderer.setPixelRatio(window.devicePixelRatio);
document.body.appendChild(renderer.domElement);

// --- Câmera e Controles ---
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(30, window.innerWidth / window.innerHeight, 0.1, 20);
camera.position.set(0, 1.5, 4);




// Adicionar um objeto invisível na cena para os braços
const armTarget = new THREE.Object3D();
armTarget.visible = false;
scene.add(armTarget);

const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 1, 0);
controls.update();

const ambient = new THREE.AmbientLight(0xfff1d6, 0.8); // Aumentei de 0.4 para 2.5
scene.add(ambient);

const dir = new THREE.DirectionalLight(0xffffff, 1.8); // Aumentei de 0.6 para 3.5
dir.position.set(1.0, 4.0, 2.0);
scene.add(dir);




function loadVRM() {

    const loader = new GLTFLoader()

    // Registrar ambos os plugins
    loader.register((parser) => {
        return new VRMLoaderPlugin(parser)
    });

    loader.register((parser) => {
        return new VRMSpringBoneLoaderPlugin(parser);
    });

    loader.load("./lyly.vrm", (gltf) => {

        const vrm = gltf.userData.vrm

        currentVrm = vrm

        // girar avatar para frente
        vrm.scene.rotation.y = 0

        scene.add(vrm.scene)

        // 🧬 NOVO: Descobrir e cachear todos os meshes com blendshapes
        discoverMorphMeshes(vrm.scene)

        setupBones(vrm)

        console.log("VRM carregado")
        console.log(`[MorphMeshes] Encontrados ${morphMeshes.length} meshes com blendshapes`)

        // 🧪 Log das shapes disponíveis em cada mesh (debug)
        morphMeshes.forEach((mesh, i) => {
            const shapes = Object.keys(mesh.morphTargetDictionary || {})
            console.log(`  Mesh[${i}] "${mesh.name}": ${shapes.length} shapes →`, shapes)
        })

    });


}


// 🧬 Descobre e cacheia meshes com blendshapes (versão segura)
function discoverMorphMeshes(object3D) {
    morphMeshes = [];

    object3D.traverse((child) => {
        if (!child.isMesh) return;
        if (!child.morphTargetDictionary) return;

        const keys = Object.keys(child.morphTargetDictionary);

        if (keys.length === 0) return;

        // ✅ Filtro leve: pega meshes que parecem faciais (Fcl_) OU fallback geral
        const hasFcl = keys.some(k => k.includes("Fcl_"));

        if (hasFcl || keys.length > 10) {
            morphMeshes.push(child);

            console.log(`[MorphMesh] ✔ ${child.name}`, keys);
        }
    });

    console.log(`[MorphMeshes] Total: ${morphMeshes.length}`);
}



// 🧬 Aplica TODAS as blendshapes sem reset global (corrigido)
function applyAllBlendshapes(blendshapesMap) {
    if (!blendshapesMap) return;

    for (const mesh of morphMeshes) {
        if (!mesh.morphTargetDictionary || !mesh.morphTargetInfluences) continue;

        const dict = mesh.morphTargetDictionary;

        for (const shapeName in dict) {
            if (!shapeName.startsWith("Fcl_")) continue;

            // ❌ NÃO aplica Eye_Close aqui
            if (shapeName === "Fcl_EYE_Close") continue;

            const index = dict[shapeName];
            const newValue = blendshapesMap[shapeName] ?? 0.0;

            mesh.morphTargetInfluences[index] =
                THREE.MathUtils.clamp(newValue, 0.0, 1.0);
        }
    }
}


function applyEyeCloseOverride(value) {
    const v = THREE.MathUtils.clamp(value, 0.0, 1.0);

    for (const mesh of morphMeshes) {
        const dict = mesh.morphTargetDictionary;
        if (!dict || dict["Fcl_EYE_Close"] === undefined) continue;

        const index = dict["Fcl_EYE_Close"];

        if (!mesh.morphTargetInfluences) continue;

        mesh.morphTargetInfluences[index] = v;
    }
}


function applyBlinkOverride(value) {
    const v = THREE.MathUtils.clamp(value, 0.0, 1.0);

    if (!morphMeshes || morphMeshes.length === 0) return;

    for (const mesh of morphMeshes) {
        const dict = mesh.morphTargetDictionary;
        if (!dict) continue;

        // tenta várias variações de nome (VRM muda isso às vezes)
        const index =
            dict["blink"] ??
            dict["Blink"] ??
            dict["Fcl_EYE_Close"]; // fallback

        if (index === undefined) continue;
        if (!mesh.morphTargetInfluences) continue;

        mesh.morphTargetInfluences[index] = v;
    }
}


function applyMouthOverride(blendshapesMap) {
  if (!blendshapesMap || morphMeshes.length === 0) return;

  // 🛑 Se não estiver reproduzindo áudio, força fechamento imediato na GPU
  const forceClose = lipSyncController.state === 'idle';

  for (const mesh of morphMeshes) {
    if (!mesh.morphTargetDictionary || !mesh.morphTargetInfluences) continue;
    const dict = mesh.morphTargetDictionary;

    for (const shapeName in dict) {
      if (!shapeName.startsWith("Fcl_MTH_")) continue;
      const index = dict[shapeName];
      
      // Se idle: zera direto na GPU (respeita respirações/pausas do TTS)
      // Se playing: usa o valor interpolado pelo PoseManager
      mesh.morphTargetInfluences[index] = forceClose ? 0.0 : (blendshapesMap[shapeName] ?? 0.0);
    }
  }
}



function setupBones(vrm) {
  
    // Base e Pernas (Adicionado para dar movimento ao corpo todo)
    bones.hips = vrm.humanoid.getNormalizedBoneNode("hips");
    bones.leftUpperLeg = vrm.humanoid.getNormalizedBoneNode("leftUpperLeg");
    bones.rightUpperLeg = vrm.humanoid.getNormalizedBoneNode("rightUpperLeg");
 

    // corpo
    bones.head = vrm.humanoid.getNormalizedBoneNode("head");
    bones.neck = vrm.humanoid.getNormalizedBoneNode("neck");

    bones.chest = vrm.humanoid.getNormalizedBoneNode("chest");
    bones.spine = vrm.humanoid.getNormalizedBoneNode("spine");
    bones.upperChest = vrm.humanoid.getNormalizedBoneNode("upperChest");

    bones.leftUpperArm = vrm.humanoid.getNormalizedBoneNode("leftUpperArm");
    bones.leftForeArm = vrm.humanoid.getNormalizedBoneNode("leftLowerArm");
    bones.rightUpperArm = vrm.humanoid.getNormalizedBoneNode("rightUpperArm");
    bones.rightForeArm = vrm.humanoid.getNormalizedBoneNode("rightLowerArm");

    // NOVO: mãos organizadas
    bones.hands = {
        left: getHandBones(vrm, "left"),
        right: getHandBones(vrm, "right")
    };

    bones.leftShoulder = vrm.humanoid.getNormalizedBoneNode("leftShoulder");
    bones.rightShoulder = vrm.humanoid.getNormalizedBoneNode("rightShoulder");

    // ✅ Inicializa IK na posição do ombro direito após os ossos existirem
    if (bones.rightUpperArm) {
      const shoulderWorldPos = new THREE.Vector3();
      bones.rightUpperArm.getWorldPosition(shoulderWorldPos);
      ikSystem.currentTarget.copy(shoulderWorldPos);
      ikSystem.target.copy(shoulderWorldPos); // Garante que o mouse comece alinhado
    }
}



function getHandBones(vrm, side) {

    return {
        thumb: [
            vrm.humanoid.getNormalizedBoneNode(`${side}ThumbProximal`),
            vrm.humanoid.getNormalizedBoneNode(`${side}ThumbIntermediate`),
            vrm.humanoid.getNormalizedBoneNode(`${side}ThumbDistal`)
        ],
        index: [
            vrm.humanoid.getNormalizedBoneNode(`${side}IndexProximal`),
            vrm.humanoid.getNormalizedBoneNode(`${side}IndexIntermediate`),
            vrm.humanoid.getNormalizedBoneNode(`${side}IndexDistal`)
        ],
        middle: [
            vrm.humanoid.getNormalizedBoneNode(`${side}MiddleProximal`),
            vrm.humanoid.getNormalizedBoneNode(`${side}MiddleIntermediate`),
            vrm.humanoid.getNormalizedBoneNode(`${side}MiddleDistal`)
        ],
        ring: [
            vrm.humanoid.getNormalizedBoneNode(`${side}RingProximal`),
            vrm.humanoid.getNormalizedBoneNode(`${side}RingIntermediate`),
            vrm.humanoid.getNormalizedBoneNode(`${side}RingDistal`)
        ],
        little: [
            vrm.humanoid.getNormalizedBoneNode(`${side}LittleProximal`),
            vrm.humanoid.getNormalizedBoneNode(`${side}LittleIntermediate`),
            vrm.humanoid.getNormalizedBoneNode(`${side}LittleDistal`)
        ]
    }

}







// 🧬 PoseManager
class PoseManager {
  constructor() {
    this.blendshapeKeys = [
      'Fcl_BRW_Angry','Fcl_BRW_Fun','Fcl_BRW_Joy','Fcl_BRW_Sorrow','Fcl_BRW_Surprised',
      'Fcl_EYE_Natural','Fcl_EYE_Joy','Fcl_EYE_Sorrow','Fcl_EYE_Surprised','Fcl_EYE_Spread','Fcl_EYE_Angry','Fcl_EYE_Close',
      // 👄 Visemas da Boca
      'Fcl_MTH_A', 'Fcl_MTH_I', 'Fcl_MTH_U', 'Fcl_MTH_E', 'Fcl_MTH_O' 
    ];
    this.blendshapes = { current: {}, target: {} };
    this.blendshapeKeys.forEach(key => {
      this.blendshapes.current[key] = 0;
      this.blendshapes.target[key] = 0;
    });

     this.headIntensity = 1;
     this.eyesIntensity = 1; 
     this.breathIntensity = 1; 
     this.bodySwingIntensity = 0.2; 
     this.targetHeadIntensity = 1; 
     this.targetEyesIntensity = 1; 
     this.targetBreathIntensity = 1; 
     this.targetBodySwingIntensity = 1; 
     this.headBaseRotation = new THREE.Euler(0, 0, 0); 
     this.targetHeadBaseRotation = new THREE.Euler(0, 0, 0);

  }


  setBlendshapeTarget(name, value) {
    if (this.blendshapes.target[name] !== undefined) {
      this.blendshapes.target[name] = THREE.MathUtils.clamp(value, 0.0, 1.0);
    }
  }



  updateBlendshapes(delta) {
    if (morphMeshes.length === 0) return;
    const time = performance.now() * 0.001;
    const isAngry = this.currentEmotion === 'angry';

    this.blendshapeKeys.forEach(key => {
      const current = this.blendshapes.current[key];
      const target = this.blendshapes.target[key];
      
      let lerpSpeed;
      if (key.startsWith('Fcl_MTH_')) {
        const isOpening = target > current;
        const baseSpeed = isOpening ? LIP_SYNC_CONFIG.attackSpeed : LIP_SYNC_CONFIG.releaseSpeed;
        lerpSpeed = delta * baseSpeed * LIP_SYNC_CONFIG.globalMultiplier;
      } else {
        lerpSpeed = delta * 4.5;
      }

      let next = THREE.MathUtils.lerp(current, target, lerpSpeed);

      // 🧬 Micro movimento (Original: Filtro apenas por 'EYE')
      if (!isAngry && key.includes('EYE') && !key.includes('Angry') && 
          !key.includes('Surprised') && !key.includes('Spread') && next > 0.01) {
        let min = next - 0.1;
        let max = next;
        if (next > 0.8) { min = next - 0.2; max = 1.0; }

        const noise = Math.sin(time * 0.8 + key.length) * 0.015 +
                      Math.cos(time * 1.2 + key.length * 2) * 0.01;
        next = THREE.MathUtils.clamp(next + noise, min, max);
      }

      this.blendshapes.current[key] = THREE.MathUtils.clamp(next, 0.0, 1.0);
    });

    applyAllBlendshapes(this.blendshapes.current);
  }


  update(delta) {
    this.updateBlendshapes(delta);

    this.eyesIntensity = THREE.MathUtils.lerp(
      this.eyesIntensity,
      this.targetEyesIntensity,
      delta * 3
    );
  }
}





// 🧬 CONTROLADOR DIRETO DE EMOÇÕES (Com Focus Decay Independente)
class DirectEmotionController {
  constructor() {
    this.currentEmotion = 'relaxed';
    this.targetIntensity = 0.5;
    this.currentIntensity = 0.5;
    this.modifier = null;
    this.focus = 'center';

    // 🛡️ Anti-Flickering (Transição de Expressão Facial)
    this._minTransitionMs = 1400;
    this._lerpThreshold = 0.85;
    this._lastUpdate = 0;
    this._pendingPayload = null;

    // ⏳ Timers de Retorno ao Padrão (Independentes)
    this._idleTimeoutId = null;      // Controla retorno para expressão RELAXED
    this._focusResetTimeoutId = null;// Controla retorno da cabeça para CENTER
  }

  /** 
   * 🎵 Chamar quando o áudio começar: Reseta TODOS os timers de decay
   */
  onAudioStart() {
    // Cancela timer de voltar pro relaxed
    if (this._idleTimeoutId) {
      clearTimeout(this._idleTimeoutId);
      this._idleTimeoutId = null;
    }
    // Cancela timer de centralizar a cabeça
    if (this._focusResetTimeoutId) {
      clearTimeout(this._focusResetTimeoutId);
      this._focusResetTimeoutId = null;
    }
  }

  /**
   * 🎵 Chamar quando o áudio terminar: Inicia os timers de decay
   */
  onAudioEnd() {
    // 1. Timer para centralizar a cabeça (Foco Visual)
    // Duração fixa de 4s é ideal para não ser intrusivo, mas garantir correção da postura.
    const HEAD_CENTER_DELAY = 4000; 

    if (this.focus !== 'center') {
        console.log(`[HeadControl] ⏳ Foco "${this.focus}" expirará em ${HEAD_CENTER_DELAY/1000}s...`);
        
        this._focusResetTimeoutId = setTimeout(() => {
          // Se o timer expirar, forçamos centro.
          // Isso não muda a emoção facial (ela continua triste/feliz), apenas endireita o pescoço.
          if (this.focus !== 'center') {
            console.log(`[HeadControl] 🔄 Retornando cabeça ao Center (Idle Look).`);
            this._applyFocusOverride('center');
          }
        }, HEAD_CENTER_DELAY);
    }

    // 2. Timer para relaxar a expressão facial (Intensidade)
    // Delay: Base 3s + (Intensidade * 2s).
    const emotionDelayMs = 3000 + (this.currentIntensity * 4000);
    
    console.log(`[Emotion] ⏳ Timer de Idle iniciado (${Math.round(emotionDelayMs)}ms).`);

    this._idleTimeoutId = setTimeout(() => {
      // Se o timer expirar, forçamos um retorno suave para relaxed + center
      if (this.currentEmotion !== 'relaxed') {
        console.log(`[Emotion] 🍃 Idle Timer Expirado. Retornando ao Relaxed.`);
        this.setEmotion({ emotion: 'relaxed', intensity: 0.4, modifier: null, focus: 'center' });
      } else if (this.focus !== 'center') {
          // Caso especial: Já é relaxed, mas cabeça está torta. O timer de foco acima trata isso, 
          // mas reforçamos aqui para garantir estado limpo total.
           this._applyFocusOverride('center');
      }
    }, emotionDelayMs);
  }

  setEmotion(data) {
    if (!data) return;
    
    // 🛑 LÓGICA DE SKIP: Se a IA retornou skip
    if (data.emotion === 'skip') {
        console.log(`[Emotion] ⏭️ Recebido "skip".`);
        
        // Se estiver surprised ou thinking, volta para relaxed. 
        // Se for outra emoção, mantém a última válida (persistência).
        if (this.currentEmotion === 'surprised' || this.currentEmotion === 'thinking') {
            console.log(`[Emotion] 🔄 Estado transitório (${this.currentEmotion}) detectado no Skip. Resolvendo para Relaxed.`);
            this._applyEmotion({ emotion: 'relaxed', intensity: 0.4, modifier: null, focus: 'center' });
        } else {
            console.log(`[Emotion] 🔒 Estado forte (${this.currentEmotion}) mantido (Persistência).`);
        }
        
        return; 
    }

    const now = performance.now();

    // 🛑 Cooldown: se mudou recentemente, enfileira
    if (now - this._lastUpdate < this._minTransitionMs) {
      this._pendingPayload = data;
      console.log(`[Emotion] ⏳ Payload enfileirado (cooldown: ${this._minTransitionMs}ms)`);
      return;
    }

    this._applyEmotion(data);
    this._lastUpdate = now;
  }

  _applyEmotion(data) {
    // 🧹 Reset seguro dos targets faciais
    for (const key in poseManager.blendshapes.target) {
      poseManager.blendshapes.target[key] = 0;
    }

    this.currentEmotion = data.emotion || 'relaxed';
    this.targetIntensity = data.intensity ?? 0.5;
    this.modifier = data.modifier || null;
    
    // 🎯 Lógica do Foco: Aceita o foco da IA (up/down/left/right).
    // Isso permite o Roleplay completo enquanto a frase toca ou logo após ela terminar.
    this.focus = data.focus || 'center';
    
    poseManager.currentEmotion = this.currentEmotion;
    console.log(`[Emotion] ✅ Aplicado: ${this.currentEmotion} (int: ${this.targetIntensity}, focus: ${this.focus})`);

    // Garante que o foco seja aplicado visualmente agora
    this.applyFocus(); 
  }

  /**
   * Aplica mudança de foco imediata sem passar pelo fluxo normal do update loop
   */
  _applyFocusOverride(newFocus) {
      this.focus = newFocus;
      this.applyFocus();
  }

  update(delta, poseManager) {
    // 🔄 Processa payload pendente se cooldown expirou
    if (this._pendingPayload) {
      const now = performance.now();
      if (now - this._lastUpdate >= this._minTransitionMs) {
        this.setEmotion(this._pendingPayload); 
        this._pendingPayload = null;
      }
    }

    // 🌊 Interpolação suave da intensidade
    this.currentIntensity = THREE.MathUtils.lerp(this.currentIntensity, this.targetIntensity, delta * 3.0);
    const t = this.currentIntensity;

    // 🎯 Aplicação dos Blendshapes Faciais (Olhos/Sobrancelhas)
    switch(this.currentEmotion) {
      case 'happy':
        poseManager.setBlendshapeTarget('Fcl_EYE_Joy', t);
        poseManager.setBlendshapeTarget('Fcl_BRW_Joy', t * 0.8);
        poseManager.setBlendshapeTarget('Fcl_EYE_Natural', 0.0);
        break;
      case 'sad':
        poseManager.setBlendshapeTarget('Fcl_EYE_Sorrow', t);
        poseManager.setBlendshapeTarget('Fcl_BRW_Sorrow', t * 0.9);
        poseManager.setBlendshapeTarget('Fcl_EYE_Natural', 0.0);
        break;
      case 'angry':
        poseManager.setBlendshapeTarget('Fcl_EYE_Angry', t);
        poseManager.setBlendshapeTarget('Fcl_BRW_Angry', t);
        poseManager.setBlendshapeTarget('Fcl_EYE_Spread', t * 0.5);
        poseManager.setBlendshapeTarget('Fcl_EYE_Close', t * 0.3);
        poseManager.setBlendshapeTarget('Fcl_EYE_Natural', 0.0);
        break;
      case 'surprised':
        poseManager.setBlendshapeTarget('Fcl_EYE_Surprised', t);
        poseManager.setBlendshapeTarget('Fcl_BRW_Surprised', t * 0.8);
        poseManager.setBlendshapeTarget('Fcl_EYE_Spread', t * 0.6);
        poseManager.setBlendshapeTarget('Fcl_EYE_Natural', 0.0);
        break;
      case 'relaxed':
        poseManager.setBlendshapeTarget('Fcl_EYE_Natural', 1.0);
        poseManager.setBlendshapeTarget('Fcl_BRW_Fun', 0.2);
        break;
      case 'thinking':
        poseManager.setBlendshapeTarget('Fcl_EYE_Natural', 0.6);
        poseManager.setBlendshapeTarget('Fcl_BRW_Fun', 0.0);
        break;
      case 'embarrassed':
        poseManager.setBlendshapeTarget('Fcl_EYE_Joy', t * 0.4);
        poseManager.setBlendshapeTarget('Fcl_EYE_Sorrow', t * 0.2);
        poseManager.setBlendshapeTarget('Fcl_BRW_Fun', t * 0.5);
        poseManager.setBlendshapeTarget('Fcl_EYE_Natural', 0.0);
        break;
      default:
        poseManager.setBlendshapeTarget('Fcl_EYE_Natural', 1.0);
    }

    // 🔧 Modificadores (Crying, Wink)
    if (this.modifier === 'crying' && this.currentEmotion === 'sad') {
      poseManager.setBlendshapeTarget('Fcl_EYE_Sorrow', 1.0);
      poseManager.setBlendshapeTarget('Fcl_BRW_Sorrow', 1.0);
    }
    if (this.modifier === 'wink') {
      poseManager.setBlendshapeTarget('Fcl_EYE_Joy', 0.6);
    }

    // 👁️ Foco (Head Tracking)
    this.applyFocus();
  }

  applyFocus() {
    const f = focusSystem;
    switch(this.focus) {
      case 'up':    f.target.x = 0; f.target.y = -0.4; break;
      case 'down':  f.target.x = 0; f.target.y = 0.4; break;
      case 'left':  f.target.x = -0.3; f.target.y = 0; break;
      case 'right': f.target.x = 0.3; f.target.y = 0; break;
      default:      f.target.x = 0; f.target.y = 0; break; // center
    }
  }
}





class LipSyncController {
  constructor() {
    this.state = 'idle';
    this.currentText = "";
    this.duration = 0;
    this.elapsedTime = 0; // ✅ Volta ao acumulador suave (evita saltos de progressão)
    
    window.electronAPI?.onVisemeStart((text, duration) => {
      console.log(`[LipSync] ▶ START: "${text}" (${duration.toFixed(2)}s)`);
      this.state = 'playing';
      this.currentText = text.trim();
      this.duration = Math.max(0.15, duration);
      this.elapsedTime = 0; // ✅ Reseta acumulador no início exato do áudio
    });

    window.electronAPI?.onVisemeEnd(() => {
      console.log(`[LipSync] ⏹ END (Hard Stop Absoluto)`);
      
      // 🔒 Zera TUDO imediatamente ao fim real do áudio (barreira absoluta)
      ['Fcl_MTH_A','Fcl_MTH_I','Fcl_MTH_U','Fcl_MTH_E','Fcl_MTH_O'].forEach(k => {
        poseManager.blendshapes.target[k] = 0.0;
        poseManager.blendshapes.current[k] = 0.0; 
      });
      
      this.state = 'idle';
      this.currentText = "";
    });
  }

  getVisemeWeights(char) {
    const c = char.toLowerCase();
    if (/a|á|à|â|ã/i.test(c))       return { 'Fcl_MTH_A': 0.42 };
    if (/e|é|ê/i.test(c))           return { 'Fcl_MTH_E': 0.35 };
    if (/i|í/i.test(c))             return { 'Fcl_MTH_I': 0.30 };
    if (/o|ó|ô/i.test(c))           return { 'Fcl_MTH_O': 0.40 };
    if (/u|ú/i.test(c))             return { 'Fcl_MTH_U': 0.45 };
    if (/s|z|ç|sh|ch/i.test(c))     return { 'Fcl_MTH_I': 0.12 }; 
    if (/f|v/i.test(c))             return { 'Fcl_MTH_E': 0.18 };
    
    return {}; 
  }

  update(delta, poseManager) {
    const mouthKeys = ['Fcl_MTH_A','Fcl_MTH_I','Fcl_MTH_U','Fcl_MTH_E','Fcl_MTH_O'];
    
    // 🛑 Apenas onVisemeEnd muda o estado para idle. Enquanto toca áudio, não zera nada.
    if (this.state === 'idle') {
      mouthKeys.forEach(k => poseManager.setBlendshapeTarget(k, 0.0));
      return;
    }

    // ✅ Acumulador suave + proteção contra overflow se áudio demorar mais que o esperado
    this.elapsedTime += delta;
    const progress = Math.min(this.elapsedTime / this.duration, 1.0);
    
    const cleanText = this.currentText.replace(/[^\wÀ-ÿ]/g, '');
    if (cleanText.length === 0) {
      mouthKeys.forEach(k => poseManager.setBlendshapeTarget(k, 0.0));
      return;
    }

    // 📏 Índice do caractere atual (mesma lógica original que funcionava perfeitamente)
    const charIndex = Math.min(Math.floor(progress * cleanText.length), cleanText.length - 1);
    const currentChar = cleanText[charIndex];
    const baseTargets = this.getVisemeWeights(currentChar);

    // 🌅 Fator de fechamento natural (apenas multiplica alvos, sem lerp interno)
    let closureDecay = 1.0;
    if (progress > LIP_SYNC_CONFIG.closureThreshold) {
      closureDecay = 1.0 - THREE.MathUtils.smoothstep(progress, LIP_SYNC_CONFIG.closureThreshold, 1.0);
    }

    mouthKeys.forEach(k => {
      const baseVal = baseTargets[k] ?? 0.0;
      
      // ✅ Define alvo puro + decay. PoseManager fará a interpolação suave (attack/release)
      poseManager.setBlendshapeTarget(k, Math.max(0, baseVal * closureDecay));
    });
  }
}







const lipSyncController = new LipSyncController();

const emotionController = new DirectEmotionController();

const poseManager = new PoseManager();




// 🧪 Modo de teste para expressões manuais
let testMode = false;

// 🧪 IPC: Estado do Avatar
window.electronAPI?.onAvatarStateUpdate((payload) => {
  if (emotionController && typeof emotionController.setEmotion === 'function') {
    console.log("[Emotion IPC] Recebido:", payload);
    emotionController.setEmotion(payload);
  }
});


// 🎵 NOVO: IPC para controlar o Timer de Idle da Emoção
window.electronAPI?.onVisemeStart(() => {
  if (emotionController) emotionController.onAudioStart();
});
window.electronAPI?.onVisemeEnd(() => {
  if (emotionController) emotionController.onAudioEnd();
});


function animate() {
    requestAnimationFrame(animate);

    const now = performance.now();
    const delta = Math.min((now - startTime) / 1000, 0.1);
    startTime = now;

    if (currentVrm) {
      
        // 🧪 Emoção direta (sem VAD)
        if (!testMode) {
            emotionController.update(delta, poseManager);
            
            // 👄 Sincroniza boca com a fila de áudio real
            lipSyncController.update(delta, poseManager);
        }
        
        // 🎭 Blendshapes (SEM Eye_Close final aqui)
        poseManager.update(delta);
        
        // 👁️ foco
        updateFocus(delta, poseManager);
        
        // 👁️ olhos (blink etc)
        updateEyes(delta, poseManager, focusSystem);
        
        // 🐢 corpo
        updateHead(delta, poseManager, focusSystem);
        updateIdle(delta, poseManager);
        updateSpineBreathing(delta, poseManager);
        updateShoulders(delta, poseManager);
        updateArmSwing(delta, poseManager);
        updateBodySwing(delta, poseManager);
        
                // 🦾 IK
        updateArmIK(delta, poseManager);

        if (!armPose.applied) {
            armPose.applied = true;
        }

        // ⚠️ VRM PROCESSA (Sobre-escreve shapes internos padrão)
        currentVrm.update(delta);

        // 👁️ OVERRIDE FINAL DOS OLHOS (Pós-VRM)
        const blink = eyeSystem.currentBlink || 0;
        const emotionClose = poseManager.blendshapes.current["Fcl_EYE_Close"] || 0;
        applyEyeCloseOverride(Math.max(blink, emotionClose));

        // 👄 OVERRIDE FINAL DA BOCA (Pós-VRM) 
        // Garante que Lip-Sync e Debug não sejam resetados pelo update interno do VRM
        applyMouthOverride(poseManager.blendshapes.current);

    }

    renderer.render(scene, camera);
}




// 📍 ADICIONAR APÓS: const poseManager = new PoseManager();

/**
 * 👄 DEBUG DIRECT MOUTH BLENDSHAPES (Bypass LipSync & Emotion)
 * Teclas: Q=A, W=I, E=U, R=E, T=O | F=Reset Boca
 */
window.addEventListener('keydown', (event) => {
  if (!currentVrm || morphMeshes.length === 0) return;
  
  const key = event.key.toLowerCase();
  let targetShape = null;

  // Mapeamento direto para testes isolados
  switch(key) {
    case 'q': targetShape = 'Fcl_MTH_A'; break;
    case 'w': targetShape = 'Fcl_MTH_I'; break;
    case 'e': targetShape = 'Fcl_MTH_U'; break;
    case 'r': targetShape = 'Fcl_MTH_E'; break;
    case 't': targetShape = 'Fcl_MTH_O'; break;
    case 'f': 
      // Reset todos os visemas para 0
      ['Fcl_MTH_A','Fcl_MTH_I','Fcl_MTH_U','Fcl_MTH_E','Fcl_MTH_O'].forEach(k => 
        poseManager.setBlendshapeTarget(k, 0.0)
      );
      console.log('%c👄 [DEBUG] Boca resetada (todos = 0)', 'color: #ffaa00;');
      return;
    default: return; // Ignora outras teclas para não conflitar com o sistema 1-0
  }

  if (targetShape) {
    console.log(`%c👄 [DEBUG MOUTH] Ativando ${targetShape} -> 1.0`, 'color: #00ff88; font-weight: bold;');
    
    // Zera os outros para testar isolado
    ['Fcl_MTH_A','Fcl_MTH_I','Fcl_MTH_U','Fcl_MTH_E','Fcl_MTH_O'].forEach(k => {
      poseManager.setBlendshapeTarget(k, k === targetShape ? 1.0 : 0.0);
    });
    
    // Feedback visual imediato no console com os índices descobertos na GPU
    morphMeshes.forEach(mesh => {
      const idx = mesh.morphTargetDictionary?.[targetShape];
      if (idx !== undefined) {
        console.log(`   ↳ Mesh "${mesh.name}" → Index ${idx} | Valor atual: ${mesh.morphTargetInfluences[idx]}`);
      }
    });
  }
});

console.log('%c👄 DEBUG DE BOCA ATIVO: Q=A | W=I | E=U | R=E | T=O | F=RESET', 'color: #00ccff; font-weight: bold;');









// 🧪 SISTEMA DE TESTE DE EXPRESSÕES (Teclas 1-0)
const expressionPresets = {
  '1': { // Happy
    'Fcl_EYE_Joy': 0.0,
    'Fcl_BRW_Joy': 0.8,
    'Fcl_EYE_Natural': 0.0,
    'Fcl_EYE_Sorrow': 0.0,
    'Fcl_EYE_Angry': 0.0,
    'Fcl_EYE_Surprised': 0.0,
    'Fcl_EYE_Spread': 0.0,
    'Fcl_BRW_Angry': 0.0,
    'Fcl_BRW_Sorrow': 0.0,
    'Fcl_BRW_Surprised': 0.0,
    'Fcl_BRW_Fun': 0.0
  },
  '2': { // Sad
    'Fcl_EYE_Sorrow': 0.0,
    'Fcl_BRW_Sorrow': 0.8,
    'Fcl_EYE_Joy': 0.0,
    'Fcl_EYE_Natural': 0.0,
    'Fcl_EYE_Angry': 0.0,
    'Fcl_EYE_Surprised': 0.0,
    'Fcl_EYE_Spread': 0.0,
    'Fcl_BRW_Angry': 0.0,
    'Fcl_BRW_Joy': 0.0,
    'Fcl_BRW_Surprised': 0.0,
    'Fcl_BRW_Fun': 0.0
  },
  '3': { // Angry
    'Fcl_EYE_Angry': 0.8,
    'Fcl_BRW_Angry': 1.0,
    'Fcl_EYE_Close': 0.0,
    'Fcl_EYE_Joy': 0.0,
    'Fcl_EYE_Natural': 0.0,
    'Fcl_EYE_Sorrow': 0.0,
    'Fcl_EYE_Surprised': 0.0,
    'Fcl_EYE_Spread': 0.0,
    'Fcl_BRW_Joy': 0.0,
    'Fcl_BRW_Sorrow': 0.0,
    'Fcl_BRW_Surprised': 0.0,
    'Fcl_BRW_Fun': 0.0
  },
  '4': { // Surprised
    'Fcl_EYE_Surprised': 0.9,
    'Fcl_BRW_Surprised': 0.9,
    'Fcl_EYE_Spread': 0.5,
    'Fcl_EYE_Joy': 0.0,
    'Fcl_EYE_Natural': 0.0,
    'Fcl_EYE_Sorrow': 0.0,
    'Fcl_EYE_Angry': 0.0,
    'Fcl_BRW_Angry': 0.0,
    'Fcl_BRW_Joy': 0.0,
    'Fcl_BRW_Sorrow': 0.0,
    'Fcl_BRW_Fun': 0.0
  },
  '5': { // Relaxed/Natural
    'Fcl_EYE_Natural': 1.0,
    'Fcl_BRW_Fun': 0.4,
    'Fcl_EYE_Joy': 0.0,
    'Fcl_EYE_Sorrow': 0.0,
    'Fcl_EYE_Angry': 0.0,
    'Fcl_EYE_Surprised': 0.0,
    'Fcl_EYE_Spread': 0.0,
    'Fcl_BRW_Angry': 0.0,
    'Fcl_BRW_Joy': 0.0,
    'Fcl_BRW_Sorrow': 0.0,
    'Fcl_BRW_Surprised': 0.0
  },
  '6': { // Wink (Joy + Spread)
    'Fcl_EYE_Joy': 0.8,
    'Fcl_EYE_Spread': 0.6,
    'Fcl_BRW_Joy': 0.5,
    'Fcl_EYE_Natural': 0.0,
    'Fcl_EYE_Sorrow': 0.0,
    'Fcl_EYE_Angry': 0.0,
    'Fcl_EYE_Surprised': 0.0,
    'Fcl_BRW_Angry': 0.0,
    'Fcl_BRW_Sorrow': 0.0,
    'Fcl_BRW_Surprised': 0.0,
    'Fcl_BRW_Fun': 0.0
  },
  '7': { // Determined (Angry + Spread)
    'Fcl_EYE_Angry': 0.7,
    'Fcl_EYE_Spread': 0.4,
    'Fcl_BRW_Angry': 0.6,
    'Fcl_EYE_Joy': 0.0,
    'Fcl_EYE_Natural': 0.0,
    'Fcl_EYE_Sorrow': 0.0,
    'Fcl_EYE_Surprised': 0.0,
    'Fcl_BRW_Joy': 0.0,
    'Fcl_BRW_Sorrow': 0.0,
    'Fcl_BRW_Surprised': 0.0,
    'Fcl_BRW_Fun': 0.0
  },
  '8': { // Embarrassed (Joy + Sorrow mix)
    'Fcl_EYE_Joy': 0.5,
    'Fcl_EYE_Sorrow': 0.3,
    'Fcl_BRW_Joy': 0.4,
    'Fcl_BRW_Sorrow': 0.3,
    'Fcl_EYE_Natural': 0.0,
    'Fcl_EYE_Angry': 0.0,
    'Fcl_EYE_Surprised': 0.0,
    'Fcl_EYE_Spread': 0.0,
    'Fcl_BRW_Angry': 0.0,
    'Fcl_BRW_Surprised': 0.0,
    'Fcl_BRW_Fun': 0.0
  },
  '9': { // Excited (Joy + Surprised)
    'Fcl_EYE_Joy': 0.7,
    'Fcl_EYE_Surprised': 0.5,
    'Fcl_BRW_Joy': 0.6,
    'Fcl_BRW_Surprised': 0.4,
    'Fcl_EYE_Natural': 0.0,
    'Fcl_EYE_Sorrow': 0.0,
    'Fcl_EYE_Angry': 0.0,
    'Fcl_EYE_Spread': 0.3,
    'Fcl_BRW_Angry': 0.0,
    'Fcl_BRW_Sorrow': 0.0,
    'Fcl_BRW_Fun': 0.0
  },
  '0': { // Reset / Neutral
    'Fcl_EYE_Joy': 0.0,
    'Fcl_EYE_Sorrow': 0.0,
    'Fcl_EYE_Angry': 0.0,
    'Fcl_EYE_Surprised': 0.0,
    'Fcl_EYE_Spread': 0.0,
    'Fcl_EYE_Natural': 0.0,
    'Fcl_BRW_Angry': 0.0,
    'Fcl_BRW_Joy': 0.0,
    'Fcl_BRW_Sorrow': 0.0,
    'Fcl_BRW_Surprised': 0.0,
    'Fcl_BRW_Fun': 0.0
  }
};

const expressionNames = {
  '1': '😊 Happy',
  '2': '😢 Sad',
  '3': '😠 Angry',
  '4': '😲 Surprised',
  '5': '😌 Relaxed',
  '6': '😉 Wink',
  '7': '😤 Determined',
  '8': '😳 Embarrassed',
  '9': '🤩 Excited',
  '0': '😐 Neutral'
};

function applyTestExpression(key) {
  const preset = expressionPresets[key];
  if (!preset) return;

  // 🎯 Ativa modo de teste automaticamente
  testMode = true;
  console.log(`%c🧪 [Teste Expressão] ${expressionNames[key] || key}`, 'color: #00ff88; font-weight: bold;');

  // Aplica diretamente no PoseManager (com interpolação suave)
  for (const [shape, value] of Object.entries(preset)) {
    poseManager.setBlendshapeTarget(shape, value);
  }

  // Feedback visual no console
  console.log('Blendshapes ativos:', preset);
}

function exitTestMode() {
  testMode = false;
  console.log('%c✅ Modo de teste desativado - Emoções retomadas', 'color: #ffaa00; font-weight: bold;');
}

// 🎹 Listener de teclado para teste de expressões
window.addEventListener('keydown', (event) => {
  const key = event.key;
  
  if (expressionPresets[key]) {
    applyTestExpression(key);
  }
  
  // ESC sai do modo de teste e volta para emoções automáticas
  if (event.key === 'Escape') {
    if (testMode) {
      exitTestMode();
    } else {
      applyTestExpression('0');
    }
  }
});

console.log('%c🎭 Sistema de Teste de Expressões Ativo!', 'color: #ff6b6b; font-weight: bold;');
console.log('Teclas 1-0: Alterna entre expressões | ESC: Sai do modo teste (volta para emoções)');
console.log(expressionNames);






function moveArmTarget() {
    const positions = [
        { x: 0, y: 1, z: 2 },
        { x: 1, y: 1.5, z: 3 },
        { x: -1, y: 0.5, z: 4 },
        { x: 0, y: 2, z: 5 }
    ];

    const index = Math.floor(Math.random() * positions.length);
    const position = positions[index];

    armTarget.position.set(position.x, position.y, position.z);
}

function resetBodyPose() {
    if (bones.hips) {
        bones.hips.rotation.y = 0;
        bones.hips.rotation.z = 0;
    }

    if (bones.spine) {
        bones.spine.rotation.y = 0;
        bones.spine.rotation.z = 0;
    }

    if (bones.chest) {
        bones.chest.rotation.y = 0;
        bones.chest.rotation.z = 0;
    }

    if (bones.upperChest) {
        bones.upperChest.rotation.y = 0;
        bones.upperChest.rotation.z = 0;
    }

    if (bones.leftUpperArm) bones.leftUpperArm.rotation.z = 0.3;
    if (bones.rightUpperArm) bones.rightUpperArm.rotation.z = -0.3;
}







function updateArmIK(delta, poseManager) {
  if (!ikSystem.enabled || !bones.rightUpperArm || !bones.rightForeArm) return;

  const eyeIntensity = poseManager.eyesIntensity;

  // 🛑 Retorna suavemente à pose de descanso se intensidade baixa
  if (eyeIntensity < 0.01) {
    const shoulderPos = new THREE.Vector3();
    bones.rightUpperArm.getWorldPosition(shoulderPos);
    const restTarget = new THREE.Vector3(shoulderPos.x + 0.25, shoulderPos.y - 0.1, shoulderPos.z + 0.6);
    ikSystem.currentTarget.lerp(restTarget, delta * 2);
    return;
  }

  // 🌊 Interpolação suave para o alvo do mouse (regra de suavidade absoluta)
  ikSystem.currentTarget.lerp(ikSystem.target, delta * ikSystem.lerpSpeed);

  // Micro-sway procedural orgânico
  const swayX = Math.sin(idle.time * 1.2) * 0.04 * eyeIntensity;
  const swayY = Math.cos(idle.time * 0.9) * 0.03 * eyeIntensity;
  const finalTarget = new THREE.Vector3(
    ikSystem.currentTarget.x + swayX,
    ikSystem.currentTarget.y + swayY,
    ikSystem.currentTarget.z
  );

  // 🦾 IK Procedural (2 ossos) - Lei dos cossenos
  const shoulderPos = new THREE.Vector3();
  bones.rightUpperArm.getWorldPosition(shoulderPos);

  const dirToTarget = new THREE.Vector3().subVectors(finalTarget, shoulderPos);
  const dist = dirToTarget.length();

  // Segurança: evita divisão por zero ou normalização inválida
  if (dist < 0.01) return;

  dirToTarget.normalize();

  // Comprimentos aproximados (escala VRM padrão)
  const upperLen = 0.28;
  const lowerLen = 0.26;
  const maxReach = upperLen + lowerLen - 0.01;

  let c = Math.min(dist, maxReach);
  if (c < 0.01) c = 0.01; // Evita acos(NaN) em distâncias mínimas

  // Cálculo de ângulos com proteção contra NaN (clamp do domínio do acos)
  const cosUpper = (upperLen * upperLen + c * c - lowerLen * lowerLen) / (2 * upperLen * c);
  const cosLower = (upperLen * upperLen + lowerLen * lowerLen - c * c) / (2 * upperLen * lowerLen);

  let angleUpper = Math.acos(THREE.MathUtils.clamp(cosUpper, -1.0, 1.0));
  let angleLower = Math.PI - Math.acos(THREE.MathUtils.clamp(cosLower, -1.0, 1.0));

  // Clamp rigoroso de constraints angulares
  const uMin = ARM_IK_CONSTRAINTS.upper.lower;
  const uMax = ARM_IK_CONSTRAINTS.upper.upper;
  const lMin = ARM_IK_CONSTRAINTS.lower.lower;
  const lMax = ARM_IK_CONSTRAINTS.lower.upper;

  angleUpper = THREE.MathUtils.clamp(angleUpper, uMin, uMax);
  angleLower = THREE.MathUtils.clamp(angleLower, lMin, lMax);

  // Eixo de dobra perpendicular à direção e ao up global
  const upVec = new THREE.Vector3(0, 1, 0);
  const bendAxis = new THREE.Vector3().crossVectors(dirToTarget, upVec).normalize();
  if (bendAxis.lengthSq() < 0.0001) {
    // Se estiver alinhado com Y, usa Z como fallback para evitar flip súbito
    bendAxis.set(0, 0, 1);
  }

  // Quaternions alvo no espaço mundial
  const targetUpperQuat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, -1, 0), dirToTarget);
  targetUpperQuat.multiply(new THREE.Quaternion().setFromAxisAngle(bendAxis, -angleUpper));

  const targetLowerQuat = new THREE.Quaternion().setFromAxisAngle(bendAxis, angleLower);

  // 🎚️ Interpolação suave das rotações (delta-independent)
  const rotSpeed = 8.0 * delta;
  bones.rightUpperArm.quaternion.slerp(targetUpperQuat, rotSpeed);
  bones.rightForeArm.quaternion.slerp(targetLowerQuat, rotSpeed);
}



function updateBodySwing(delta, poseManager) {
    const intensity = poseManager.bodySwingIntensity;

    idle.time += delta;
    const t = idle.time;

    // 🛑 desligado TOTAL
    if (intensity < 0.01) {
        resetBodyPose();
        return;
    }

    // ======================
    // 🌊 MOVIMENTO BASE (controlado)
    // ======================
    const baseWave = Math.sin(t * 1.4);
    const secondaryWave = Math.sin(t * 2.6 + 1.3) * 0.4;

    const swing = (baseWave + secondaryWave) * 0.025 * intensity;
    const tilt = Math.cos(t * 1.6) * 0.02 * intensity;

    // ======================
    // 🧠 "VIDA" (micro variação procedural)
    // ======================
    const noise = Math.sin(t * 3.7 + Math.sin(t * 0.5)) * 0.005 * intensity;

    // ======================
    // 🧍 HIPS (origem)
    // ======================
    if (bones.hips) {
        bones.hips.rotation.y = swing + noise;
        bones.hips.rotation.z = tilt;
    }

    // ======================
    // 🫁 DELAY (ESSENCIAL PRA VIDA)
    // ======================
    const spineLag = Math.sin((t - 0.08) * 1.4);
    const chestLag = Math.sin((t - 0.16) * 1.4);
    const upperLag = Math.sin((t - 0.24) * 1.4);

    if (bones.spine) {
        bones.spine.rotation.y = spineLag * 0.5 * intensity + noise;
        bones.spine.rotation.z = tilt * 0.6;
    }

    if (bones.chest) {
        bones.chest.rotation.y = chestLag * 0.45 * intensity;
        bones.chest.rotation.z = tilt * 0.4;
    }

    if (bones.upperChest) {
        bones.upperChest.rotation.y = upperLag * 0.35 * intensity;
        bones.upperChest.rotation.z = tilt * 0.2;
    }

    // ======================
    // 💪 BRAÇOS (SOLTOS = VIDA)
    // ======================
    
    /*
    if (bones.rightUpperArm && bones.leftUpperArm) {
        const armWave = Math.sin(t * 1.8 + 0.5);

        bones.rightUpperArm.rotation.z = -0.3 + armWave * 0.08 * intensity;
        bones.leftUpperArm.rotation.z = 0.3 - armWave * 0.08 * intensity;
    }
    */    
}


function updateHead(delta, poseManager, focusSystem) {
    const h = headSystem;

    h.time += delta;

    // 🎯 intensidade vinda do PoseManager
    const intensity = poseManager.headIntensity;
    const base = poseManager.headBaseRotation;

    // 🛑 se desligado → só base
    if (intensity < 0.01) {
        if (bones.neck) {
            bones.neck.rotation.x = base.x * 0.4;
            bones.neck.rotation.y = base.y * 0.5;
        }

        if (bones.head) {
            bones.head.rotation.x = base.x;
            bones.head.rotation.y = base.y;
            bones.head.rotation.z = base.z;
        }
        return;
    }

    // 🎯 alvo vindo do foco (mantido 👍)
    const targetX = focusSystem.target.y * 0.5;
    const targetY = focusSystem.target.x * 0.6;

    // 🧠 smoothing consistente com delta
    const followSpeed = 3; // ajustável
    h.current.x += (targetX - h.current.x) * delta * followSpeed;
    h.current.y += (targetY - h.current.y) * delta * followSpeed;

    // 🌊 micro movimento (idle)
    const micro = Math.sin(h.time * 1.5) * 0.02 * intensity;

    // 🦴 NECK (amortecimento natural)
    if (bones.neck) {
        bones.neck.rotation.x =
            base.x * 0.4 +
            h.current.x * 0.4 * intensity +
            micro * 0.5;

        bones.neck.rotation.y =
            base.y * 0.5 +
            h.current.y * 0.5 * intensity;
    }

    // 🦴 HEAD (principal)
    if (bones.head) {
        bones.head.rotation.x =
            base.x +
            h.current.x * intensity +
            micro;

        bones.head.rotation.y =
            base.y +
            h.current.y * intensity;

        bones.head.rotation.z = base.z;
    }
}




function updateBlink(delta, poseManager) {
    const e = eyeSystem;
    e.blinkTimer += delta;
    const intensity = poseManager.eyesIntensity;
    const isAngry = poseManager.currentEmotion === 'angry';

    if (intensity < 0.01) {
        applyBlinkOverride(0);
        e.currentBlink = 0;
        return;
    }

    // 🐢 Intervalo de piscada adaptativo
    let blinkInterval = 2 + Math.random() * 5;
    if (isAngry) blinkInterval = 7 + Math.random() * 6; // Pisca muito menos quando bravo

    if (!e.blinking && e.blinkTimer > blinkInterval) {
        e.blinking = true;
        e.blinkTimer = 0;
        e.blinkProgress = 0;
        e.blinkInterval = blinkInterval;
    }

    if (e.blinking) {
        e.blinkProgress += delta / e.blinkDuration;
        let v = e.blinkProgress < 0.5 ? e.blinkProgress * 2 : (1 - e.blinkProgress) * 2;
        
        // Em angry, o blink é mais rápido e menos intenso
        v *= isAngry ? intensity * 0.6 : intensity;

        e.currentBlink = v;

        if (e.blinkProgress >= 1) e.blinking = false;
    } else {
        e.currentBlink = 0;
    }
}



function updateSaccade(delta, poseManager, focusSystem) {
    const e = eyeSystem;

    const intensity = poseManager.eyesIntensity;

    // 🛑 desligado
    if (intensity < 0.01) {
        e.offset.x = 0;
        e.offset.y = 0;
        return;
    }

    // 🎯 base: foco
    const targetX = focusSystem.target.x;
    const targetY = focusSystem.target.y;

    // 🎲 micro movimento reduzido por intensidade
    const randomX = (Math.random() - 0.5) * 0.1 * intensity;
    const randomY = (Math.random() - 0.5) * 0.05 * intensity;

    // 🧠 smoothing com delta
    const speed = 10;

    e.offset.x += ((targetX + randomX) - e.offset.x) * delta * speed;
    e.offset.y += ((targetY + randomY) - e.offset.y) * delta * speed;
}




function applyEyes(poseManager) {
    if (!currentVrm || !currentVrm.lookAt || !currentVrm.lookAt.applier || typeof currentVrm.lookAt.applier.apply !== 'function') return;

    const e = eyeSystem;
    const intensity = poseManager.eyesIntensity;

    // 🛑 desligado
    if (intensity < 0.01) return;

    const lookX = headSystem.current.y + e.offset.x;
    const lookY = headSystem.current.x + e.offset.y;

    currentVrm.lookAt.applier.apply(
        new THREE.Vector3(
            lookX * intensity,
            lookY * intensity,
            1
        )
    );
}





function updateEyes(delta, poseManager, focusSystem) {
    const e = eyeSystem;

    e.time += delta;

    updateBlink(delta, poseManager);
    updateSaccade(delta, poseManager, focusSystem);
    applyEyes(poseManager);
}



function generateFocus(poseManager) {
    const f = focusSystem;

    const intensity = poseManager.eyesIntensity;

    // 🛑 desligado
    if (intensity < 0.01) return;

    // 🎯 novo alvo (reduzido por intensidade)
    f.target.x = (Math.random() - 0.5) * 0.3 * intensity;
    f.target.y = (Math.random() - 0.5) * 0.2 * intensity;

    f.holding = true;
    f.holdTime = (1 + Math.random() * 2) / Math.max(intensity, 0.2);

    // 👀 blink opcional
    if (Math.random() < 0.4 * intensity) {
        forceBlink?.();
    }
}



function updateFocus(delta, poseManager) {
    const f = focusSystem;
    const intensity = poseManager.eyesIntensity;

    // 🛑 desligado
    if (intensity < 0.01) return;

    f.timer += delta;

    if (f.holding) {
        f.holdTime -= delta;

        if (f.holdTime <= 0) {
            f.holding = false;
            f.timer = 0;
        }

    } else {

        // intervalo depende da intensidade
        if (f.timer > f.interval / Math.max(intensity, 0.2)) {

            f.timer = 0;
            f.interval = 2 + Math.random() * 4;

            generateFocus(poseManager);
        }
    }

    // Atualizar a posição do armTarget com base no foco
    if (bones.head) {
        const lookX = headSystem.current.y + eyeSystem.offset.x;
        const lookY = headSystem.current.x + eyeSystem.offset.y;
        armTarget.position.set(lookX * intensity, lookY * intensity, 1);
    }
}






function updateIdle(delta, poseManager) {
    const intensity = poseManager.breathIntensity;

    idle.time += delta;
    const t = idle.time;

    // 🛑 desligado
    if (intensity < 0.01) {
        if (bones.chest) bones.chest.rotation.x = 0;
        if (bones.spine) bones.spine.rotation.x = 0;
        if (bones.upperChest) bones.upperChest.rotation.x = 0;
        return;
    }

    // 🫁 respiração
    const breath = Math.sin(t * 1.2) * 0.02 * intensity;

    // 🌊 sway leve
    const sway = Math.sin(t * 0.6) * 0.01 * intensity;

    // 🦴 aplica (sem destruir pose futura)
    if (bones.chest) {
        bones.chest.rotation.x = breath;
        bones.chest.rotation.y = sway;
    }

    if (bones.spine) {
        bones.spine.rotation.x = breath * 0.5;
    }

    if (bones.upperChest) {
        bones.upperChest.rotation.x = breath * 1.2;
    }
}


function updateArmSwing(delta, poseManager) {
  const intensity = poseManager.breathIntensity;
  const eyeIntensity = poseManager.eyesIntensity;

  idle.time += delta;
  const t = idle.time;

  if (intensity < 0.01) return;

  const swingAmplitude = Math.sin(t * 1.5) * 0.03 * intensity * eyeIntensity;
  const foreArmAmplitude = 0.05 * intensity * eyeIntensity;

  if (bones.leftUpperArm && bones.rightUpperArm) {
    const leftBase = -1.15;
    const rightBase = 1.15;

    // IK controlará a rotação final do braço direito, 
    // aqui aplicamos apenas a base idle para o braço esquerdo
    bones.leftUpperArm.rotation.z = leftBase + swingAmplitude;
    // bones.rightUpperArm.rotation.z = rightBase - swingAmplitude; // REMOVIDO: IK assume controle
  }

  if (bones.leftForeArm && bones.rightForeArm) {
    bones.leftForeArm.rotation.x = Math.sin(t * 1.5 + 0.2) * foreArmAmplitude;
    bones.rightForeArm.rotation.x = -Math.sin(t * 1.5 + 0.2) * foreArmAmplitude;
  }
}




function updateShoulders(delta, poseManager) {
    const intensity = poseManager.breathIntensity;

    const t = idle.time;

    if (intensity < 0.01) return;

    const micro = Math.sin(t * 0.5) * 0.01 * intensity;

    if (bones.leftShoulder && bones.rightShoulder) {

        bones.leftShoulder.rotation.z = micro;
        bones.rightShoulder.rotation.z = micro;
    }
}



export function updateSpineBreathing(delta, poseManager) {
    const intensity = poseManager.breathIntensity;

    const t = idle.time;

    if (intensity < 0.01) return;

    const breathX = Math.sin(t * 0.5) * 0.01 * intensity;
    const breathZ = Math.cos(t * 0.5) * 0.01 * intensity;

    if (bones.spine) {
        bones.spine.rotation.x = breathX;
        bones.spine.rotation.z = breathZ;
    }
}




loadVRM()
animate()





window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});