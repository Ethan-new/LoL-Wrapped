import { Controller } from "@hotwired/stimulus"

// Connects to data-controller="update-player"
// Refreshes player data from Riot API with 5-minute cooldown
export default class extends Controller {
  static values = {
    url: String,
    lastUpdated: String  // ISO 8601 timestamp of player's last update
  }

  static targets = ["button"]
  static COOLDOWN_SECONDS = 300  // 5 minutes

  connect() {
    this.checkCooldown()
  }

  async update(event) {
    event.preventDefault()
    event.stopImmediatePropagation()

    if (this.cooldownRemaining() > 0) return
    if (this.updating) return

    this.updating = true
    this.setLoading(true)

    try {
      const response = await fetch(this.urlValue, {
        method: "PATCH",
        headers: {
          "Accept": "application/json",
          "Content-Type": "application/json",
          "X-CSRF-Token": document.querySelector("[name='csrf-token']")?.content
        }
      })

      if (response.ok) {
        window.location.reload()
      } else if (response.status === 429) {
        this.updating = false
        this.setLoading(false)
        this.updateButtonState()
      } else {
        const data = await response.json().catch(() => ({}))
        alert(data.error || "Failed to refresh profile")
        this.updating = false
        this.setLoading(false)
      }
    } catch (err) {
      alert("Failed to refresh profile")
      this.updating = false
      this.setLoading(false)
    }
  }

  cooldownRemaining() {
    if (!this.hasLastUpdatedValue || !this.lastUpdatedValue) return 0
    const lastUpdated = new Date(this.lastUpdatedValue).getTime()
    if (Number.isNaN(lastUpdated)) return 0
    const cooldownEndsAt = lastUpdated + (this.constructor.COOLDOWN_SECONDS * 1000)
    const remaining = (cooldownEndsAt - Date.now()) / 1000
    return Math.max(0, remaining)
  }

  checkCooldown() {
    const remaining = this.cooldownRemaining()
    if (remaining > 0) {
      this.updateButtonState()
      this.startCountdown()
    }
  }

  startCountdown() {
    if (this.countdownInterval) clearInterval(this.countdownInterval)
    this.countdownInterval = setInterval(() => {
      const remaining = this.cooldownRemaining()
      this.updateButtonState()
      if (remaining <= 0) clearInterval(this.countdownInterval)
    }, 1000)
  }

  updateButtonState() {
    const remaining = Math.ceil(this.cooldownRemaining())
    if (!this.hasButtonTarget) return

    const btn = this.buttonTarget
    if (remaining > 0) {
      btn.disabled = true
      btn.setAttribute("aria-disabled", "true")
      btn.title = `Available in ${remaining} seconds`
      btn.textContent = `Refresh in ${remaining}s`
    } else {
      btn.disabled = false
      btn.removeAttribute("aria-disabled")
      btn.title = ""
      btn.textContent = "Refresh profile"
    }
  }

  setLoading(loading) {
    if (!this.hasButtonTarget) return

    const btn = this.buttonTarget
    if (loading) {
      btn.disabled = true
      btn.setAttribute("aria-disabled", "true")
      btn.title = "Refreshing..."
      btn.textContent = "Refreshing…"
    } else {
      this.updateButtonState()
    }
  }
}
