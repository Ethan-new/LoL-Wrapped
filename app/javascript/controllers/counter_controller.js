import { Controller } from "@hotwired/stimulus"

// Connects to data-controller="counter"
// Animates numbers from 0 to target value when the element enters the viewport
export default class extends Controller {
  static targets = ["number"]
  static values = {
    duration: { type: Number, default: 1500 },
    decimals: { type: Number, default: 0 }
  }

  connect() {
    this.animated = false
    this.observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting && !this.animated) {
            this.animated = true
            this.animateAll()
          }
        })
      },
      { threshold: 0.3 }
    )
    this.observer.observe(this.element)
  }

  disconnect() {
    this.observer?.disconnect()
  }

  animateAll() {
    this.numberTargets.forEach((target) => {
      const value = parseInt(target.dataset.counterValue || "0", 10)
      this.animateValue(target, 0, value)
    })
  }

  animateValue(element, start, end) {
    const startTime = performance.now()

    const update = (currentTime) => {
      const elapsed = currentTime - startTime
      const progress = Math.min(elapsed / this.durationValue, 1)
      // ease-out expo - slowest near the end
      const eased = progress === 1 ? 1 : 1 - Math.pow(2, -10 * progress)
      const current = Math.floor(start + (end - start) * eased)
      element.textContent = current.toLocaleString()

      if (progress < 1) {
        requestAnimationFrame(update)
      } else {
        element.textContent = end.toLocaleString()
      }
    }

    requestAnimationFrame(update)
  }
}
