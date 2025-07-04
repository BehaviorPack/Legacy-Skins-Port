import * as THREE from "three";
import { InteractionManager } from "three.interactive";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import * as TWEEN from "@tweenjs/tween.js";

import { SkinpackLoader, generateSkinModel } from "./skin.js";

const DEBUG = new URLSearchParams(location.search).has("debug");

export class Viewer {
  constructor(div) {
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
    this.raycaster = new THREE.Raycaster();
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      logarithmicDepthBuffer: true,
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    div.appendChild(this.renderer.domElement);

    this.interactionManager = new InteractionManager(this.renderer, this.camera, this.renderer.domElement);

    // create controls
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.target.set(0, 15, 0);
    this.camera.position.set(0, 30, 40);
    this.controls.update();

    //const dirLight = new THREE.DirectionalLight( 0xffffff, 2 );
    //dirLight.color.setHSL( 0.1, 1, 1.95 );
    //dirLight.position.set( -1, 1.75, 1 );
    //dirLight.position.multiplyScalar( 30 );
    //this.scene.add( dirLight );

    // skybox
    //const skylight = new THREE.AmbientLight( 0x606060 ); // soft white light
    //this.scene.add( skylight );

    if (!DEBUG || true) {
      new THREE.CubeTextureLoader()
        .loadAsync([1, 3, 4, 5, 0, 2].map((e) => `panorama/panorama_${e}.png`))
        .then((cubeTexture) => {
          this.scene.background = cubeTexture;
        });
    }

    this.loaded_models = new THREE.Group();
    this.scene.add(this.loaded_models);

    // resize handler
    window.addEventListener("resize", this.onWindowResize.bind(this), false);

    // drag & drop
    this.renderer.domElement.addEventListener("dragover", (ev) => {
      ev.target.setAttribute("drop-active", true);
      ev.preventDefault();
    });

    this.renderer.domElement.addEventListener("dragleave", (ev) => {
      ev.target.setAttribute("drop-active", false);
      ev.preventDefault();
    });

    this.drag_drop_notify = document.createElement("div");
    this.drag_drop_notify.id = "drag_drop_notify";
    const drag_drop_text = document.createElement("span");
    drag_drop_text.textContent = "Drag & Drop an mcpack file containing models or click here";
    this.drag_drop_notify.appendChild(drag_drop_text);
    this.drag_drop_notify.style.display = "none";

    this.renderer.domElement.addEventListener("drop", this.dropHandler.bind(this));
    this.drag_drop_notify.addEventListener("drop", this.dropHandler.bind(this));
    this.drag_drop_notify.addEventListener("click", () => {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = ".zip,.mcpack";
      input.addEventListener("change", () => {
        if (input.files.length > 0) {
          this.load_file(input.files[0]);
        }
      });
      input.click();
    });
    div.appendChild(this.drag_drop_notify);

    // load models when asked
    window.addEventListener("message", (m) => {
      if (m.data.load_blob) {
        console.log(m.data);
        this.load_blob(m.data.load_blob, "mcpack");
      }
    });

    const parent = window.opener ?? window.parent;
    if (parent && parent !== window) {
      parent.postMessage("loaded");
    } else {
      this.load_url("Festive Skins 2014.zip").catch((err) => {
        console.warn("Failed to auto-load Festive Skins 2014.zip:", err);
        this.drag_drop_notify.style.display = "";
      });
    }

    document.addEventListener("pointerdown", (e) => {
      this._ptDown = [e.offsetX, e.offsetY];
    });
    document.addEventListener("pointerup", (e) => {
      this._ptUp = [e.offsetX, e.offsetY];
    });

    this.render();
  }

  isDragClick() {
    let { _ptDown, _ptUp } = this;
    let d = Math.hypot(_ptUp[0] - _ptDown[0], _ptUp[1] - _ptDown[1]);
    return d > 4;
  }

  onWindowResize() {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }

  /**
   *
   * @param {DragEvent} ev
   */
  dropHandler(ev) {
    ev.preventDefault();
    ev.target.setAttribute("drop-active", false);
    this.load_file(ev.dataTransfer.files[0]);
  }

  /**
   *
   * @param {File} file
   */
  async load_file(file) {
    const ext = file.name.split(".").at(-1);
    return this.load_blob(file, ext);
  }

  async load_url(filename) {
    const ext = filename.split(".").at(-1);
    const resp = await fetch(filename);
    return this.load_blob(await resp.blob(), ext);
  }

  /**
   *
   * @param {Blob} blob
   * @param {string} ext
   */
  async load_blob(blob, ext) {
    window.scene_skinpacks = this.loaded_models;

    if (["zip", "mcpack", "mcpersona"].includes(ext)) {
      this.loaded_models.clear();
      const loader = new SkinpackLoader();
      const meshes = await loader.loadAsync(blob);
      this.drag_drop_notify.style.display = "none";
      for (const mesh of meshes) {
        this.addSkin(mesh);
      }
      this.align_group(this.loaded_models);
    } else if (["png"].includes(ext)) {
      const image = await createImageBitmap(blob);
      const texture = SkinTexture(image);

      this.loaded_models.traverse((obj) => {
        if (!obj.isMinecraftMesh) return;
        obj.material = new THREE.MeshStandardMaterial({
          map: texture,
          side: THREE.DoubleSide,
          transparent: true,
          alphaTest: 1e-5,
        });
      });
    } else if (ext == "json") {
      this.loaded_models.clear();
      const data = JSON.parse(new TextDecoder().decode(await blob.arrayBuffer()));
      const name = Object.keys(data).filter((k) => k != "format_version")[0];
      const geometry = data[name];
      const mesh = generateSkinModel(null, geometry);
      mesh.name = name;
      this.drag_drop_notify.style.display = "none";
      this.addSkin(mesh);
    }
  }

  addSkin(mesh) {
    mesh.addEventListener("click", (event) => {
      if (this.isDragClick()) {
        return;
      }
      const skin = event.target;
      const aabb = new THREE.Box3();
      aabb.setFromObject(skin);
      console.log(`clicked: ${skin.name}`);

      const center = new THREE.Vector3();
      aabb.getCenter(center);
      const coords = new THREE.Vector3();
      coords.copy(this.controls.target);
      TWEEN.add(
        new TWEEN.Tween(coords)
          .to(center, 100)
          .onUpdate(() => {
            this.camera.position.setX(coords.x);
            //this.camera.position.setY(coords.y+20);
            this.controls.target.copy(coords);
          })
          .start()
      );
    });
    this.interactionManager.add(mesh);
    this.loaded_models.add(mesh);
  }

  align_group(group) {
    let total_size = 0;
    const sizes = [];
    for (const i in group.children) {
      const mesh = group.children[i];
      const aabb = new THREE.Box3();
      aabb.setFromObject(mesh);
      const bounds = aabb.getSize(new THREE.Vector3());
      bounds.x += 4;
      sizes.push(bounds.x);
      total_size += bounds.x;
    }

    let offset = -total_size / 2;
    for (const i in group.children) {
      const mesh = group.children[i];
      mesh.position.add(new THREE.Vector3(offset + sizes[i] / 2, 0, 0));
      offset += sizes[i];
    }
  }

  render(time) {
    this.renderer.render(this.scene, this.camera);
    this.interactionManager.update();
    TWEEN.update(time);
    this.camera.updateMatrixWorld();
    this.controls.update();
    requestAnimationFrame(this.render.bind(this));
  }
}
