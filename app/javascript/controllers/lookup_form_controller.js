import { Controller } from "@hotwired/stimulus"

// Connects to data-controller="lookup-form"
export default class extends Controller {
  static targets = ["submit"]

  connect() {
    this.originalText = this.submitTarget.value
  }

  submit(event) {
    if (this.hasSubmitTarget) {
      this.submitTarget.disabled = true
      this.submitTarget.value = "Looking up…"
    }
  }
}
