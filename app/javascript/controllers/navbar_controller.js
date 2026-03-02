import { Controller } from "@hotwired/stimulus"

// Connects to data-controller="navbar"
// Fades navbar background from ~10% opacity at top to ~95% as user scrolls
export default class extends Controller {
  static values = {
    minOpacity: { type: Number, default: 0.1 },
    maxOpacity: { type: Number, default: 0.95 },
    scrollThreshold: { type: Number, default: 150 }
  }

  connect() {
    this.boundUpdate = this.update.bind(this)
    window.addEventListener("scroll", this.boundUpdate, { passive: true })
    this.update()
  }

  disconnect() {
    window.removeEventListener("scroll", this.boundUpdate)
  }

  update() {
    const scrollY = window.scrollY || document.documentElement.scrollTop
    const minOpacity = this.minOpacityValue
    const maxOpacity = this.maxOpacityValue
    const scrollThreshold = this.scrollThresholdValue
    const progress = Math.min(1, scrollY / scrollThreshold)
    const opacity = minOpacity + (maxOpacity - minOpacity) * progress
    this.element.style.backgroundColor = `rgba(0, 0, 0, ${opacity})`
  }
}
