import * as THREE from "three";
import { ZipLoadingManager } from "./ziploader.js";
import { VertexNormalsHelper } from "three/addons/helpers/VertexNormalsHelper.js";

const DEBUG = new URLSearchParams(location.search).has("debug");

function extrudeTexture(image) {
  const padding = 0;
  const imageWidth = image.width;
  const imageHeight = image.height;
  const canvas = new OffscreenCanvas(image.width + padding * 2, image.height + padding * 2);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(image, 0, 0);
  return canvas.transferToImageBitmap();

  // Draw the main image in the center with padding around it
  ctx.drawImage(image, padding, padding, imageWidth, imageHeight);

  // Draw left edge (clamping the leftmost 1 pixel of the image)
  ctx.drawImage(image, 0, 0, 1, imageHeight, 0, padding, padding, imageHeight);

  // Draw right edge (clamping the rightmost 1 pixel of the image)
  ctx.drawImage(image, imageWidth - 1, 0, 1, imageHeight, imageWidth + padding, padding, padding, imageHeight);

  // Draw top edge (clamping the topmost 1 pixel of the image)
  ctx.drawImage(image, 0, 0, imageWidth, 1, padding, 0, imageWidth, padding);

  // Draw bottom edge (clamping the bottommost 1 pixel of the image)
  ctx.drawImage(image, 0, imageHeight - 1, imageWidth, 1, padding, imageHeight + padding, imageWidth, padding);

  // Draw top-left corner (clamping the top-left pixel)
  ctx.drawImage(image, 0, 0, 1, 1, 0, 0, padding, padding);

  // Draw top-right corner (clamping the top-right pixel)
  ctx.drawImage(image, imageWidth - 1, 0, 1, 1, imageWidth + padding, 0, padding, padding);

  // Draw bottom-left corner (clamping the bottom-left pixel)
  ctx.drawImage(image, 0, imageHeight - 1, 1, 1, 0, imageHeight + padding, padding, padding);

  // Draw bottom-right corner (clamping the bottom-right pixel)
  ctx.drawImage(
    image,
    imageWidth - 1,
    imageHeight - 1,
    1,
    1,
    imageWidth + padding,
    imageHeight + padding,
    padding,
    padding
  );

  (async () => {
    const blob = await canvas.convertToBlob();
    const img = document.createElement("img");
    img.src = URL.createObjectURL(blob);
    img.style.imageRendering = "crisp-edges";
    document.body.appendChild(img);
  })();

  return canvas.transferToImageBitmap();
}

/**
 *
 * @param {THREE.Texture} texture
 * @returns
 */
function SkinMaterial(texture) {
  const vertShader = `
        attribute float highlight;

        uniform bool SHADE;
        uniform int LIGHTSIDE;

        varying vec2 vUv;
        varying float light;
        varying float lift;

        float AMBIENT = 0.5;
        float XFAC = -0.15;
        float ZFAC = 0.05;

        void main()
        {

            if (SHADE) {

                vec3 N = normalize( vec3( modelMatrix * vec4(normal, 0.0) ) );

                if (LIGHTSIDE == 1) {
                    float temp = N.y;
                    N.y = N.z * -1.0;
                    N.z = temp;
                }
                if (LIGHTSIDE == 2) {
                    float temp = N.y;
                    N.y = N.x;
                    N.x = temp;
                }
                if (LIGHTSIDE == 3) {
                    N.y = N.y * -1.0;
                }
                if (LIGHTSIDE == 4) {
                    float temp = N.y;
                    N.y = N.z;
                    N.z = temp;
                }
                if (LIGHTSIDE == 5) {
                    float temp = N.y;
                    N.y = N.x * -1.0;
                    N.x = temp;
                }

                float yLight = (1.0+N.y) * 0.5;
                light = yLight * (1.0-AMBIENT) + N.x*N.x * XFAC + N.z*N.z * ZFAC + AMBIENT;

            } else {

                light = 1.0;

            }

            if (highlight == 2.0) {
                lift = 0.22;
            } else if (highlight == 1.0) {
                lift = 0.1;
            } else {
                lift = 0.0;
            }
            
            vUv = uv;
            vec4 mvPosition = modelViewMatrix * vec4( position, 1.0 );
            gl_Position = projectionMatrix * mvPosition;
        }`;
  const fragShader = `
        #ifdef GL_ES
        precision highp float;
        #endif

        uniform sampler2D map;

        uniform bool SHADE;
        uniform bool EMISSIVE;
        uniform vec3 LIGHTCOLOR;

        varying vec2 vUv;
        varying float light;
        varying float lift;

        void main(void)
        {
            vec2 pixelSize = 1.0 / vec2(textureSize(map, 0)); // Calculate the size of one pixel
            vec2 adjustedUv = vUv + 0.5 * pixelSize; 
            vec2 clampedUv = clamp(vUv, 0.0, 1.0); 
            vec4 color = texture2D(map, clampedUv);

            if (color.a < 0.01) discard;

            if (EMISSIVE == false) {

                gl_FragColor = vec4(lift + color.rgb * light, color.a);
                gl_FragColor.r = gl_FragColor.r * LIGHTCOLOR.r;
                gl_FragColor.g = gl_FragColor.g * LIGHTCOLOR.g;
                gl_FragColor.b = gl_FragColor.b * LIGHTCOLOR.b;
            } else {

                float light_r = (light * LIGHTCOLOR.r) + (1.0 - light * LIGHTCOLOR.r) * (1.0 - color.a);
                float light_g = (light * LIGHTCOLOR.g) + (1.0 - light * LIGHTCOLOR.g) * (1.0 - color.a);
                float light_b = (light * LIGHTCOLOR.b) + (1.0 - light * LIGHTCOLOR.b) * (1.0 - color.a);
                gl_FragColor = vec4(lift + color.r * light_r, lift + color.g * light_g, lift + color.b * light_b, 1.0);

            }

            if (lift > 0.2) {
                gl_FragColor.r = gl_FragColor.r * 0.6;
                gl_FragColor.g = gl_FragColor.g * 0.7;
            }
        }`;

  const global_light_color = new THREE.Color().setHex(0xffffff);
  const global_light_side = 4;
  const brightness = 50;

  const mat = new THREE.ShaderMaterial({
    uniforms: {
      map: { type: "t", value: texture },
      SHADE: { type: "bool", value: true },
      LIGHTCOLOR: { type: "vec3", value: new THREE.Color().copy(global_light_color).multiplyScalar(brightness / 50) },
      LIGHTSIDE: { type: "int", value: global_light_side },
      EMISSIVE: { type: "bool", value: false },
    },
    vertexShader: vertShader,
    fragmentShader: fragShader,
    blending: THREE.NormalBlending,
    side: THREE.DoubleSide,
    transparent: true,
  });
  mat.name = "SkinMaterial";
  return mat;
}

function SkinTexture(texture) {
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return texture;
}

// the default minecraft model for either alex or steve
function defaultGeometry(slim) {
  const width = slim ? 3 : 4;

  return {
    texturewidth: 64,
    textureheight: 64,
    visible_bounds_height: 2,
    visible_bounds_width: 1,
    visible_bounds_offset: [0, 1, 0],
    bones: [
      {
        name: "root",
        pivot: [0.0, 0.0, 0.0],
      },
      {
        name: "body",
        parent: "waist",
        pivot: [0.0, 24.0, 0.0],
        cubes: [
          {
            origin: [-4.0, 12.0, -2.0],
            size: [8, 12, 4],
            uv: [16, 16],
          },
        ],
      },
      {
        name: "waist",
        parent: "root",
        pivot: [0.0, 12.0, 0.0],
      },
      {
        name: "head",
        parent: "body",
        pivot: [0.0, 24.0, 0.0],
        cubes: [
          {
            origin: [-4.0, 24.0, -4.0],
            size: [8, 8, 8],
            uv: [0, 0],
          },
        ],
      },
      {
        name: "cape",
        pivot: [0.0, 24, 3.0],
        parent: "body",
      },
      {
        name: "hat",
        parent: "head",
        pivot: [0.0, 24.0, 0.0],
        cubes: [
          {
            origin: [-4.0, 24.0, -4.0],
            size: [8, 8, 8],
            uv: [32, 0],
            inflate: 0.5,
          },
        ],
      },
      {
        name: "leftArm",
        parent: "body",
        pivot: [5.0, 22.0, 0.0],
        cubes: [
          {
            origin: [4, 12.0, -2.0],
            size: [width, 12, 4],
            uv: [32, 48],
          },
        ],
      },
      {
        name: "leftSleeve",
        parent: "leftArm",
        pivot: [5.0, 22.0, 0.0],
        cubes: [
          {
            origin: [4, 12.0, -2],
            size: [width, 12, 4],
            uv: [48, 48],
            inflate: 0.25,
          },
        ],
      },
      {
        name: "leftItem",
        pivot: [6.0, 15.0, 1.0],
        parent: "leftArm",
      },
      {
        name: "rightArm",
        parent: "body",
        pivot: [-5.0, 22.0, 0.0],
        cubes: [
          {
            origin: [-(4 + width), 12.0, -2.0],
            size: [width, 12, 4],
            uv: [40, 16],
          },
        ],
      },
      {
        name: "rightSleeve",
        parent: "rightArm",
        pivot: [-5.0, 22.0, 0.0],
        cubes: [
          {
            origin: [-(4 + width), 12.0, -2.0],
            size: [width, 12, 4],
            uv: [40, 32],
            inflate: 0.25,
          },
        ],
      },
      {
        name: "rightItem",
        pivot: [-6, 15, 1],
        locators: {
          lead_hold: [-6, 15, 1],
        },
        parent: "rightArm",
      },
      {
        name: "leftLeg",
        parent: "root",
        pivot: [1.9, 12.0, 0.0],
        cubes: [
          {
            origin: [-0.1, 0.0, -2.0],
            size: [4, 12, 4],
            uv: [16, 48],
          },
        ],
      },
      {
        name: "leftPants",
        parent: "leftLeg",
        pivot: [1.9, 12.0, 0.0],
        cubes: [
          {
            origin: [-0.1, 0.0, -2.0],
            size: [4, 12, 4],
            uv: [0, 48],
            inflate: 0.25,
          },
        ],
      },
      {
        name: "rightLeg",
        parent: "root",
        pivot: [-1.9, 12.0, 0.0],
        cubes: [
          {
            origin: [-3.9, 0.0, -2.0],
            size: [4, 12, 4],
            uv: [0, 16],
          },
        ],
      },
      {
        name: "rightPants",
        parent: "rightLeg",
        pivot: [-1.9, 12.0, 0.0],
        cubes: [
          {
            origin: [-3.9, 0.0, -2.0],
            size: [4, 12, 4],
            uv: [0, 32],
            inflate: 0.25,
          },
        ],
      },
      {
        name: "jacket",
        parent: "body",
        pivot: [0.0, 24.0, 0.0],
        cubes: [
          {
            origin: [-4.0, 12.0, -2.0],
            size: [8, 12, 4],
            uv: [16, 32],
            inflate: 0.25,
          },
        ],
      },
    ],
  };
}

function setUVs(box, uv, xyz, w, h) {
  const pixelOffsetU = 0; //0.5 / w;  // Offset by half a pixel in U direction
  const pixelOffsetV = 0; //0.5 / h;  // Offset by half a pixel in V direction

  const toFaceVertices = (x1, y1, x2, y2) => [
    new THREE.Vector2((x1 + pixelOffsetU) / w, 1.0 - (y2 + pixelOffsetV) / h),
    new THREE.Vector2((x2 - pixelOffsetU) / w, 1.0 - (y2 + pixelOffsetV) / h),
    new THREE.Vector2((x2 - pixelOffsetU) / w, 1.0 - (y1 - pixelOffsetV) / h),
    new THREE.Vector2((x1 + pixelOffsetU) / w, 1.0 - (y1 - pixelOffsetV) / h),
  ];

  let top, bottom, left, front, right, back;
  if (uv instanceof Array) {
    let [u, v] = uv;
    const [width, height, depth] = xyz;
    top = toFaceVertices(u + depth, v, u + width + depth, v + depth);
    bottom = toFaceVertices(u + width + depth, v, u + width * 2 + depth, v + depth);
    left = toFaceVertices(u, v + depth, u + depth, v + depth + height);
    front = toFaceVertices(u + depth, v + depth, u + width + depth, v + depth + height);
    right = toFaceVertices(u + width + depth, v + depth, u + width + depth * 2, v + height + depth);
    back = toFaceVertices(u + width + depth * 2, v + depth, u + width * 2 + depth * 2, v + height + depth);
  } else {
    function face(a) {
      if (!a) {
        return toFaceVertices(0, 0, 1, 1);
      }
      const [u, v] = a.uv;
      const [u2, v2] = a.uv_size;
      return toFaceVertices(u, v, u + u2, v + v2);
    }

    top = face(uv.up);
    bottom = face(uv.down);
    left = face(uv.east);
    front = face(uv.north);
    right = face(uv.west);
    back = face(uv.south);
  }

  const uvAttr = box.attributes.uv;
  uvAttr.array = new Float32Array(
    [
      right[3],
      right[2],
      right[0],
      right[1],
      left[3],
      left[2],
      left[0],
      left[1],
      top[3],
      top[2],
      top[0],
      top[1],
      bottom[0],
      bottom[1],
      bottom[3],
      bottom[2],
      front[3],
      front[2],
      front[0],
      front[1],
      back[3],
      back[2],
      back[0],
      back[1],
    ].flatMap((e) => [e.x, e.y])
  );
  uvAttr.needsUpdate = true;

  box.setAttribute("color", new THREE.Float32BufferAttribute(uvAttr.array, 2));
}

function parsePolyMesh(polyMesh) {
  const expandedPositionsArray = [];
  const expandedNormalsArray = [];
  const expandedUvsArray = [];
  const indicesArray = [];

  const { positions, normals, uvs, polys, normalized_uvs } = polyMesh;

  const flipNormal = (n) => {
    return [-n[0], -n[1], -n[2]];
  };

  polys.forEach((polygon) => {
    const polygonIndices = polygon.map((vertex) => {
      const [positionIndex, normalIndex, uvIndex] = vertex;

      // Push the corresponding position, normal, and UV
      expandedPositionsArray.push(...positions[positionIndex]);
      expandedNormalsArray.push(...flipNormal(normals[normalIndex]));

      const uv = uvs[uvIndex];
      expandedUvsArray.push(...(normalized_uvs ? uv : uv.map((val, i) => val * (i % 2 === 0 ? 1 : 1)))); // Assuming normalization logic

      // Return the current index for the new expanded arrays
      return expandedPositionsArray.length / 3 - 1;
    });

    // Split quads into triangles if necessary
    if (polygon.length === 3) {
      // Triangle
      indicesArray.push(...polygonIndices);
    } else if (polygon.length === 4) {
      // Quad, split into two triangles
      indicesArray.push(polygonIndices[0], polygonIndices[1], polygonIndices[2]); // First triangle
      indicesArray.push(polygonIndices[2], polygonIndices[3], polygonIndices[0]); // Second triangle
    }
  });

  // Create BufferGeometry
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(expandedPositionsArray, 3));
  geometry.setAttribute("normal", new THREE.Float32BufferAttribute(expandedNormalsArray, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(expandedUvsArray, 2));
  geometry.setIndex(indicesArray);
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(expandedUvsArray, 2));

  return geometry;
}

function loadBones(bones, texturewidth, textureheight, material) {
  const ret = [];
  for (const bone of bones) {
    let part;
    if (bone.cubes) {
      const pivot = new THREE.Object3D();
      pivot.name = bone.name;
      pivot.position.set(bone.pivot[0], bone.pivot[1], bone.pivot[2]);
      if (bone.rotation) {
        pivot.rotation.setFromVector3(new THREE.Vector3(...bone.rotation));
      }
      part = pivot;

      bone.cubes.forEach((cube) => {
        const pivOff = pivot.position; // wrong

        const origin = cube.origin.map((o, i) => o + cube.size[i] / 2);
        const size = cube.size.map((s) => (s += cube.inflate ?? 0));
        origin[2] -= origin[2] * 2;

        const box = new THREE.BoxGeometry(...size);
        setUVs(box, cube.uv, cube.size, texturewidth, textureheight);
        const box_mesh = new THREE.Mesh(box, material);
        box_mesh.position.fromArray(origin);
        box_mesh.position.sub(pivOff);
        box_mesh.isMinecraftMesh = true;
        part.add(box_mesh);
      });
    } else if (bone.poly_mesh) {
      const geometry = parsePolyMesh(bone.poly_mesh);
      part = new THREE.Mesh(geometry, material);
      part.name = bone.name;
      part.isMinecraftMesh = true;
      if (DEBUG) {
        ret.push(new VertexNormalsHelper(part, 1, 0xff0000));
      }
    } else {
      continue;
    }
    ret.push(part);
  }
  return ret;
}

/**
 *
 * @param {THREE.Texture} texture
 * @param {*} geometry
 * @returns {THREE.SkinnedMesh}
 */
export function generateSkinModel(texture, geometry) {
  const material = texture ? SkinMaterial(texture) : new THREE.MeshNormalMaterial();

  const mdl = new THREE.Group();
  mdl.isSkin = true;
  const bones = loadBones(geometry.bones, geometry.texturewidth, geometry.textureheight, material);
  bones.forEach((bone) => mdl.add(bone));
  return mdl;
}

async function loadTexture(loadingManager, url) {
  const loader = new THREE.TextureLoader(loadingManager);
  return loader.loadAsync(url);
}

export class SkinpackLoader extends THREE.Loader {
  constructor(manager) {
    super(manager);
  }

  load(url, onLoad, onProgress, onError) {
    const scope = this;
    if (url instanceof Blob) {
      scope.parse(url).then(onLoad);
      return;
    }
    const loader = new THREE.FileLoader(this.manager);
    loader.setPath(this.path);
    loader.setResponseType("blob");
    loader.setRequestHeader(this.requestHeader);
    loader.setWithCredentials(this.withCredentials);
    loader.load(
      url,
      function (blob) {
        try {
          scope.parse(blob).then(onLoad);
        } catch (e) {
          if (onError) {
            onError(e);
          } else {
            console.error(e);
          }
          scope.manager.itemError(url);
        }
      },
      onProgress,
      onError
    );
  }

  async parse(blob) {
    const zr = new zip.ZipReader(new zip.BlobReader(blob));
    const loadingManager = new ZipLoadingManager(zr);
    await loadingManager.Load();

    const loader = new THREE.FileLoader(loadingManager);
    if (!loadingManager.entries.has("manifest.json")) {
      loadingManager.entries.forEach((v, k) => {
        if (k.endsWith("manifest.json")) {
          loadingManager.baseFolder = k.split("/").slice(0, -1);
        }
      });
    }

    const manifest = JSON.parse(await loader.loadAsync("manifest.json"));
    if (manifest.modules[0].type == "persona_piece") {
      return await this.parse_persona(loadingManager, loader);
    } else {
      return this.parse_skin(loadingManager, loader);
    }
  }

  async parse_skin(loadingManager, loader) {
    const skins_list = JSON.parse(await loader.loadAsync("skins.json"));

    let geometry_list = {};
    try {
      geometry_list = JSON.parse(await loader.loadAsync("geometry.json"));
    } catch (e) {}

    const out = [];
    for (const i in skins_list.skins) {
      const skin = skins_list.skins[i];

      let geometry;
      switch (skin.geometry) {
        case "geometry.humanoid.customSlim":
        case "geometry.humanoid":
          geometry = defaultGeometry(true);
          break;
        case "geometry.humanoid.custom":
          geometry = defaultGeometry(false);
          break;
        default:
          geometry = geometry_list[skin.geometry];
          break;
      }

      try {
        const texture = await loadTexture(loadingManager, skin.texture)
          .then((t) => SkinTexture(t))
          .catch((e) => {
            console.error("failed to load texture", skin);
          });

        const mesh = generateSkinModel(texture, geometry, 2);
        mesh.name = skin.localization_name;
        out.push(mesh);
      } catch (e) {
        console.error("failed to load", skin, e);
      }
    }

    return out;
  }
}
