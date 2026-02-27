import { Controller } from "@hotwired/stimulus"

// Seamless infinite horizontal scroll - resets position invisibly when one set is scrolled
export default class extends Controller {
  static values = {
    speed: { type: Number, default: 45 }
  }

  connect() {
    this.track = this.element.querySelector("[data-carousel-track]")
    if (!this.track) return

    this.cards = this.track.querySelectorAll("[data-carousel-card]")
    this.setWidth = 0
    this.position = 0
    this.lastTime = null
    this.rafId = null

    if (this.cards.length >= 6) {
      const count = Math.min(6, this.cards.length)
      for (let i = 0; i < count; i++) {
        this.setWidth += this.cards[i].offsetWidth
      }
      const style = getComputedStyle(this.track)
      const gap = parseFloat(style.gap) || 20
      this.setWidth += Math.max(0, count - 1) * gap
    }
    if (this.setWidth <= 0 && this.track.scrollWidth > 0) {
      this.setWidth = this.track.scrollWidth / 2
    }

    this.track.style.willChange = "transform"

    this.animate = this.animate.bind(this)
    this.rafId = requestAnimationFrame(this.animate)
  }

  disconnect() {
    if (this.rafId) cancelAnimationFrame(this.rafId)
  }

  animate(timestamp) {
    if (this.lastTime == null) this.lastTime = timestamp
    const delta = (timestamp - this.lastTime) / 1000
    this.lastTime = timestamp

    this.position += this.speedValue * delta
    if (this.setWidth > 0 && this.position >= this.setWidth) {
      this.position -= this.setWidth
    }

    this.track.style.transform = `translateX(-${this.position}px)`

    this.rafId = requestAnimationFrame(this.animate)
  }
}
