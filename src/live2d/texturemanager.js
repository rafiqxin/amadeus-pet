/* Texture manager (port of LAppTextureManager). */

export class TextureInfo {
  constructor() {
    this.img = null
    this.id = null
    this.width = 0
    this.height = 0
    this.usePremultiply = false
    this.fileName = ''
  }
}

export class TextureManager {
  constructor() {
    this._textures = []
    this._gl = null
  }

  setGl(gl) {
    this._gl = gl
  }

  createTextureFromPngFile(fileName, usePremultiply, callback) {
    const gl = this._gl
    for (const t of this._textures) {
      if (t.fileName === fileName && t.usePremultiply === usePremultiply) {
        t.img = new Image()
        t.img.addEventListener('load', () => callback(t), { passive: true })
        t.img.src = fileName
        return
      }
    }

    const img = new Image()
    img.addEventListener(
      'load',
      () => {
        const tex = gl.createTexture()
        gl.bindTexture(gl.TEXTURE_2D, tex)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
        if (usePremultiply) gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, 1)
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img)
        gl.generateMipmap(gl.TEXTURE_2D)
        gl.bindTexture(gl.TEXTURE_2D, null)

        const info = new TextureInfo()
        info.fileName = fileName
        info.width = img.width
        info.height = img.height
        info.id = tex
        info.img = img
        info.usePremultiply = usePremultiply
        this._textures.push(info)
        callback(info)
      },
      { passive: true }
    )
    img.src = fileName
  }

  releaseTextures() {
    for (const t of this._textures) {
      if (t && t.id) this._gl.deleteTexture(t.id)
    }
    this._textures.length = 0
  }
}
