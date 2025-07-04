import * as THREE from 'three'; 

export class ZipLoadingManager extends THREE.LoadingManager {
    constructor(zr) {
        super();
        this.baseFolder = "";
        this.zr = zr;
        this.setURLModifier((url) => {
            if(this.baseFolder) {
                url = this.baseFolder + "/" + url;
            }
            const e = this.entries.get(url);
            if(!e) return `${url} not found`;
            return e;
        });
    }

    async Load() {
        if(this.entries) {
            return;
        }
        const entries = await this.zr.getEntries();
        this.entries = new Map();
        for(const entry of entries) {
            let mime = "";
            const ext = entry.filename.split(".")[1];
            switch(ext) {
            case "png":
                mime = "image/png";
                break;
            }
            const url = URL.createObjectURL(await entry.getData(new zip.BlobWriter(mime)));
            this.entries.set(entry.filename, url);
        }
    }
}
