import { Controller } from "@hotwired/stimulus"

// Connects to data-controller="hero-video"
export default class extends Controller {
  static targets = ["video", "icon"]

  connect() {
    this.videoTarget.addEventListener("play", () => this.updateIcon())
    this.videoTarget.addEventListener("pause", () => this.updateIcon())
    this.updateIcon()
  }

  toggle() {
    if (this.videoTarget.paused) {
      this.videoTarget.play()
    } else {
      this.videoTarget.pause()
    }
    this.updateIcon()
  }

  updateIcon() {
    if (!this.hasIconTarget) return
    if (this.videoTarget.paused) {
      this.iconTarget.innerHTML = '<path d="M8 5v14l11-7z"/>'
    } else {
      this.iconTarget.innerHTML = '<path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z"/>'
    }
    this.iconTarget.setAttribute("aria-label", this.videoTarget.paused ? "Play video" : "Pause video")
  }
}
