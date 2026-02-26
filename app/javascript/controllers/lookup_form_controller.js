import { Controller } from "@hotwired/stimulus"

// Connects to data-controller="lookup-form"
export default class extends Controller {
  static targets = ["arrow"]

  submit() {
    if (this.hasArrowTarget) {
      this.arrowTarget.textContent = "…"
    }
    this.element.querySelector('[type="submit"]')?.setAttribute("disabled", "")
  }
}
