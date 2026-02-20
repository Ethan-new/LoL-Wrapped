import { Controller } from "@hotwired/stimulus"

// Connects to data-controller="share-url"
export default class extends Controller {
  static values = {
    url: String
  }

  copy() {
    navigator.clipboard.writeText(this.urlValue).then(() => {
      const btn = this.element.querySelector("[data-action*='copy']")
      if (btn) {
        const original = btn.textContent
        btn.textContent = "Copied!"
        setTimeout(() => { btn.textContent = original }, 1500)
      }
    })
  }
}
