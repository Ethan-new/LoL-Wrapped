import { Controller } from "@hotwired/stimulus"

// Escapes a string for safe insertion into HTML (prevents XSS).
function escapeHtml(str) {
  if (str == null || str === "") return ""
  const s = String(str)
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
}

// Connects to data-controller="recap"
// Triggers year recap ingestion and can show recap results
export default class extends Controller {
  static values = {
    ingestUrl: String,
    computeUrl: String,
    recapUrl: String,
    playerId: Number,
    recapStatuses: Object
  }

  static targets = ["yearSelect", "generateButton", "viewButton", "computeButton", "message", "recapResults"]

  connect() {
    this.updateStatusDisplay()
    this.startPollingIfGenerating()
  }

  disconnect() {
    this.stopPolling()
  }

  startPollingIfGenerating() {
    this.stopPolling()
    const statuses = this.recapStatusesValue || {}
    const year = this.hasYearSelectTarget ? this.yearSelectTarget.value : new Date().getFullYear()
    if (statuses[String(year)] === "generating") {
      this.pollInterval = setInterval(() => this.pollForReady(year), 10000)
    }
  }

  stopPolling() {
    if (this.pollInterval) {
      clearInterval(this.pollInterval)
      this.pollInterval = null
    }
  }

  async pollForReady(year) {
    if (!this.recapUrlValue) return
    const url = this.recapUrlValue.replace("YEAR", year)
    try {
      const response = await fetch(url, { headers: { "Accept": "application/json" } })
      if (!response.ok) return
      const data = await response.json().catch(() => ({}))
      const hasData = (data.most_played_with?.length || data.most_beat_us?.length || (data.total_pings ?? 0) > 0 || (data.total_game_seconds ?? 0) > 0 || (data.total_gold_spent ?? 0) > 0 || (data.fav_items?.length ?? 0) > 0) ||
        (data.extra_stats && Object.values(data.extra_stats).some((v) => v != null && Number(v) > 0)) ||
        (data.our_team_bans?.length ?? 0) > 0 || (data.enemy_team_bans?.length ?? 0) > 0 ||
        (data.total_kills ?? 0) > 0 || (data.total_deaths ?? 0) > 0 || (data.total_assists ?? 0) > 0
      if (hasData) {
        this.stopPolling()
        this.recapStatusesValue = { ...(this.recapStatusesValue || {}), [year]: "ready" }
        this.updateStatusDisplay()
        this.showMessage("Recap is ready! Click \"View recap\" to see it.", "success")
      }
    } catch (_err) {
      // ignore network errors, will retry next poll
    }
  }

  updateStatusDisplay() {
    const statuses = this.recapStatusesValue || {}
    const year = this.hasYearSelectTarget ? this.yearSelectTarget.value : new Date().getFullYear()
    const status = statuses[String(year)]
    const isGenerating = status === "generating"
    const isFailed = status === "failed"

    this.updateButtonState("generate", isGenerating, "Generating…", "Generate recap")
    this.updateButtonState("view", isGenerating, "Please wait…", "View recap")
    this.updateButtonState("compute", isGenerating, "Computing…", "Compute")

    if (isGenerating) {
      this.showMessage("Recap is generating for this year. This may take a few minutes…", "success")
      this.startPollingIfGenerating()
    } else {
      this.stopPolling()
    }
    if (isFailed) {
      this.showMessage("Recap generation failed for this year. You can try again.", "error")
    }
  }

  updateButtonState(name, disabled, disabledText, normalText) {
    const targetMap = { generate: "generateButton", view: "viewButton", compute: "computeButton" }
    const targetName = targetMap[name]
    if (!this[`has${targetName.charAt(0).toUpperCase() + targetName.slice(1)}Target`]) return

    const btn = this[`${targetName}Target`]
    btn.disabled = disabled
    btn.textContent = disabled ? disabledText : normalText
    if (disabled) {
      btn.setAttribute("aria-disabled", "true")
      btn.title = "Please wait..."
    } else {
      btn.removeAttribute("aria-disabled")
      btn.title = ""
    }
  }

  async generate(event) {
    event.preventDefault()
    if (!this.ingestUrlValue) return
    if (this.generating) return

    const year = this.yearSelectTarget?.value || new Date().getFullYear()
    if (!year || year < 2010 || year > new Date().getFullYear()) {
      this.showMessage("Please select a valid year.", "error")
      return
    }

    this.generating = true
    this.setButtonLoading("generate", true)
    this.showMessage("", "")

    try {
      const response = await fetch(this.ingestUrlValue, {
        method: "POST",
        headers: {
          "Accept": "application/json",
          "Content-Type": "application/json",
          "X-CSRF-Token": document.querySelector("[name='csrf-token']")?.content
        },
        body: JSON.stringify({ year: parseInt(year, 10) })
      })

      const data = await response.json().catch(() => ({}))
      if (response.status === 202) {
        if (data.recap_statuses) this.recapStatusesValue = data.recap_statuses
        this.updateStatusDisplay()
        this.showMessage("Recap generation started! This may take a few minutes. Click \"View recap\" to check when it's ready.", "success")
      } else {
        this.showMessage(data.error || "Failed to start recap generation", "error")
      }
    } catch (err) {
      this.showMessage("Failed to start recap generation", "error")
    } finally {
      this.generating = false
      this.updateStatusDisplay()
    }
  }

  async compute(event) {
    event.preventDefault()
    if (!this.computeUrlValue) return

    const year = this.yearSelectTarget?.value || new Date().getFullYear()
    if (!year || year < 2010 || year > new Date().getFullYear()) {
      this.showMessage("Please select a valid year.", "error")
      return
    }

    if (this.hasComputeButtonTarget) {
      this.computeButtonTarget.disabled = true
      this.computeButtonTarget.textContent = "Computing…"
    }

    try {
      const yearNum = parseInt(year, 10)
      const baseUrl = this.computeUrlValue
      const url = baseUrl + (baseUrl.includes("?") ? "&" : "?") + "year=" + yearNum
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Accept": "application/json",
          "Content-Type": "application/json",
          "X-CSRF-Token": document.querySelector("[name='csrf-token']")?.content
        },
        body: JSON.stringify({ year: yearNum })
      })

      const data = await response.json().catch(() => ({}))
      if (response.status === 202) {
        if (data.recap_statuses) this.recapStatusesValue = data.recap_statuses
        this.updateStatusDisplay()
        this.showMessage("Compute job queued. Click \"View recap\" when ready.", "success")
      } else {
        const msg = data.error || data.message || (response.status === 404 ? "Player not found." : response.status === 422 ? "Invalid year." : "Failed to queue compute")
        this.showMessage(msg, "error")
        console.error("[Compute] HTTP", response.status, url, data)
      }
    } catch (err) {
      this.showMessage("Failed to queue compute: " + (err?.message || "network error"), "error")
      console.error("[Compute] Error:", err)
    } finally {
      this.updateStatusDisplay()
    }
  }

  async viewRecap(event) {
    event.preventDefault()
    if (!this.recapUrlValue) return

    const year = this.hasYearSelectTarget ? this.yearSelectTarget.value : new Date().getFullYear()
    const url = this.recapUrlValue.replace("YEAR", year)
    this.setButtonLoading("view", true)

    try {
      const response = await fetch(url, {
        headers: { "Accept": "application/json" }
      })
      const contentType = response.headers.get("content-type") || ""
      let data = {}
      if (contentType.includes("application/json")) {
        data = await response.json().catch(() => ({}))
      } else if (!response.ok) {
        this.showMessage(`Recap failed (${response.status}). Try again later.`, "error")
        return
      }
      const hasExtraStats = data.extra_stats && Object.values(data.extra_stats).some((v) => v != null && Number(v) > 0)
      const hasBans = (data.our_team_bans?.length ?? 0) > 0 || (data.enemy_team_bans?.length ?? 0) > 0
      const hasKda = (data.total_kills ?? 0) > 0 || (data.total_deaths ?? 0) > 0 || (data.total_assists ?? 0) > 0
      if (response.ok && (data.most_played_with?.length || data.most_beat_us?.length || (data.total_pings ?? 0) > 0 || (data.total_game_seconds ?? 0) > 0 || (data.total_gold_spent ?? 0) > 0 || (data.fav_items?.length ?? 0) > 0 || hasExtraStats || hasBans || hasKda)) {
        this.recapStatusesValue = { ...(this.recapStatusesValue || {}), [year]: "ready" }
        this.updateStatusDisplay()
        this.showMessage("", "")
        this.renderRecap(data)
      } else if (response.ok) {
        this.showMessage(data.error || "No recap data yet. Generate a recap first.", "error")
      } else {
        this.showMessage(data.error || `Recap failed (${response.status})`, "error")
        console.error("[View recap] HTTP", response.status, url, data)
      }
    } catch (err) {
      this.showMessage("Failed to load recap: " + (err?.message || "network error"), "error")
      console.error("[View recap] Error:", err)
    } finally {
      this.setButtonLoading("view", false)
    }
  }

  formatGameTime(seconds) {
    if (!seconds || seconds <= 0) return "0h"
    const h = Math.floor(seconds / 3600)
    const m = Math.floor((seconds % 3600) / 60)
    if (h >= 24) {
      const d = Math.floor(h / 24)
      const hrs = h % 24
      if (hrs > 0) return `${d}d ${hrs}h`
      return `${d}d`
    }
    if (m > 0) return `${h}h ${m}m`
    return `${h}h`
  }

  extraStatLabel(key) {
    const labels = {
      skillshotsHit: "Skill shots hit",
      skillshotsDodged: "Skill shots dodged",
      outnumberedKills: "Outnumbered kills",
      soloKills: "Solo kills",
      saveAllyFromDeath: "Allies saved from death",
      timeCCingOthers: "Time CCing others",
      totalTimeCCDealt: "Total time CC dealt",
      scuttleCrabKills: "Scuttle crab kills",
      buffsStolen: "Buffs stolen"
    }
    return labels[key] || key.replace(/([A-Z])/g, " $1").replace(/^./, (s) => s.toUpperCase()).trim()
  }

  formatExtraStatValue(key, val) {
    if (val == null || val === "") return "0"
    const n = Number(val)
    if (Number.isNaN(n)) return String(val)
    if (key === "timeCCingOthers" || key === "totalTimeCCDealt") {
      if (n >= 3600) return `${Math.floor(n / 3600)}h ${Math.floor((n % 3600) / 60)}m`
      if (n >= 60) return `${Math.floor(n / 60)}m ${Math.floor(n % 60)}s`
      return `${Math.floor(n)}s`
    }
    return n >= 1000 ? n.toLocaleString() : String(Math.round(n))
  }

  pingLabel(key) {
    const labels = {
      allInPings: "All-in",
      assistMePings: "Assist me",
      baitPings: "Bait",
      basicPings: "Basic",
      commandPings: "Command",
      dangerPings: "Danger",
      enemyMissingPings: "Enemy missing",
      enemyVisionPings: "Enemy vision",
      getBackPings: "Get back",
      holdPings: "Hold",
      needVisionPings: "Need vision",
      onMyWayPings: "On my way",
      pushPings: "Push",
      retreatPings: "Retreat",
      visionClearedPings: "Vision cleared",
      visionPings: "Vision"
    }
    return labels[key] || key.replace(/Pings?$/i, "").replace(/([A-Z])/g, " $1").replace(/^./, (s) => s.toUpperCase()).trim()
  }

  renderRecap(data) {
    if (!this.hasRecapResultsTarget) return
    const list = data.most_played_with || []
    const enemies = data.most_beat_us || []
    const totalPings = data.total_pings ?? 0
    const totalGameSeconds = data.total_game_seconds ?? 0
    const totalGoldSpent = data.total_gold_spent ?? 0
    const totalKills = data.total_kills ?? 0
    const totalDeaths = data.total_deaths ?? 0
    const totalAssists = data.total_assists ?? 0
    const favItems = data.fav_items || []
    const ourTeamBans = data.our_team_bans || []
    const enemyTeamBans = data.enemy_team_bans || []
    const extraStats = data.extra_stats || {}
    const pingBreakdown = data.ping_breakdown || {}
    const ITEM_IMG_BASE = "https://ddragon.leagueoflegends.com/cdn/14.24.1/img/item"
    const CHAMP_IMG_BASE = "https://ddragon.leagueoflegends.com/cdn/14.24.1/img/champion"

    let html = ""
    if (totalKills > 0 || totalDeaths > 0 || totalAssists > 0) {
      const kdaRatio = totalDeaths > 0 ? ((totalKills + totalAssists) / totalDeaths).toFixed(1) : "∞"
      html += `<p class="mb-2 text-sm font-medium text-stone-400">K/D/A (all games)</p>
        <div class="rounded-lg bg-stone-900/70 px-3 py-2 mb-4 flex items-center justify-between gap-4">
          <span class="text-green-500 font-semibold">${totalKills.toLocaleString()} K</span>
          <span class="text-red-500 font-semibold">${totalDeaths.toLocaleString()} D</span>
          <span class="text-amber-400 font-semibold">${totalAssists.toLocaleString()} A</span>
          <span class="text-stone-400 text-sm">KDA ${kdaRatio}</span>
        </div>`
    }
    if (totalGoldSpent > 0) {
      html += `<p class="mb-2 text-sm font-medium text-stone-400">Total gold spent</p>
        <div class="rounded-lg bg-stone-900/70 px-3 py-2 mb-4">
          <span class="text-amber-400 font-bold text-lg">${totalGoldSpent.toLocaleString()}</span>
          <span class="text-stone-500 text-sm"> gold</span>
        </div>`
    }
    if (favItems.length > 0) {
      html += `<p class="mb-2 text-sm font-medium text-stone-400">Top 3 items built</p>
        <div class="flex flex-wrap gap-3 mb-4">` +
        favItems.filter((item) => item && ((item.item_id ?? item.itemId) != null)).map((item) => {
          const id = escapeHtml(String(item.item_id ?? item.itemId))
          const name = escapeHtml(item.name || `Item ${item.item_id ?? item.itemId}`)
          const count = item.count ?? 0
          return `
          <div class="flex items-center gap-2 rounded-lg bg-stone-900/70 px-3 py-2">
            <img src="${ITEM_IMG_BASE}/${id}.png" alt="${name}" class="h-8 w-8 rounded" onerror="this.style.display='none'">
            <div>
              <span class="text-stone-300 text-sm block">${name}</span>
              <span class="text-amber-400 font-semibold text-xs">${count} games</span>
            </div>
          </div>`
        }).join("") +
        `</div>`
    }
    if (ourTeamBans.length > 0 || enemyTeamBans.length > 0) {
      html += `<p class="mb-2 text-sm font-medium text-stone-400">Top 5 bans</p>
        <div class="grid gap-4 sm:grid-cols-2 mb-4">`
      if (ourTeamBans.length > 0) {
        html += `<div class="rounded-lg bg-stone-900/70 p-3">
          <p class="mb-2 text-xs font-medium text-stone-500">Your team banned</p>
          <div class="space-y-1">` +
          ourTeamBans.map((b) => {
            const name = escapeHtml(b.name || `Champ ${b.champion_id}`)
            const imgKey = escapeHtml(String(b.key || b.champion_id))
            return `
            <div class="flex items-center gap-2">
              <img src="${CHAMP_IMG_BASE}/${imgKey}.png" alt="${name}" class="h-6 w-6 rounded-full" onerror="this.style.display='none'">
              <span class="text-stone-300 text-sm">${name}</span>
              <span class="text-amber-400 font-semibold text-xs ml-auto">${b.count}×</span>
            </div>`
          }).join("") + `</div></div>`
      }
      if (enemyTeamBans.length > 0) {
        html += `<div class="rounded-lg bg-red-900/20 p-3">
          <p class="mb-2 text-xs font-medium text-stone-500">Enemy team banned</p>
          <div class="space-y-1">` +
          enemyTeamBans.map((b) => {
            const name = escapeHtml(b.name || `Champ ${b.champion_id}`)
            const imgKey = escapeHtml(String(b.key || b.champion_id))
            return `
            <div class="flex items-center gap-2">
              <img src="${CHAMP_IMG_BASE}/${imgKey}.png" alt="${name}" class="h-6 w-6 rounded-full" onerror="this.style.display='none'">
              <span class="text-stone-300 text-sm">${name}</span>
              <span class="text-red-400 font-semibold text-xs ml-auto">${b.count}×</span>
            </div>`
          }).join("") + `</div></div>`
      }
      html += `</div>`
    }
    const extraEntries = Object.entries(extraStats).filter(([, v]) => v != null && v !== "" && Number(v) > 0)
    if (extraEntries.length > 0) {
      html += `<p class="mb-2 text-sm font-medium text-stone-400">Combat & objective stats</p>
        <div class="grid gap-2 sm:grid-cols-2 mb-4">` +
        extraEntries.map(([key, val]) => {
          const label = escapeHtml(this.extraStatLabel(key))
          const value = escapeHtml(this.formatExtraStatValue(key, val))
          return `
          <div class="flex items-center justify-between rounded-lg bg-stone-900/70 px-3 py-2">
            <span class="text-stone-300 text-sm">${label}</span>
            <span class="text-amber-400 font-semibold">${value}</span>
          </div>`
        }).join("") +
        `</div>`
    }
    if (totalGameSeconds > 0) {
      html += `<p class="mb-2 text-sm font-medium text-stone-400">Total time in game</p>
        <div class="rounded-lg bg-stone-900/70 px-3 py-2 mb-4">
          <span class="text-amber-400 font-bold text-lg">${this.formatGameTime(totalGameSeconds)}</span>
        </div>`
    }
    if (totalPings > 0) {
      const entries = Object.entries(pingBreakdown)
        .filter(([, count]) => count > 0)
        .sort((a, b) => b[1] - a[1])
      html += `<p class="mb-2 text-sm font-medium text-stone-400">Pings you used (${totalPings.toLocaleString()} total)</p>
        <div class="space-y-1 mb-4">`
      if (entries.length > 0) {
        html += entries.map(([key, count]) => `
          <div class="flex items-center justify-between rounded-lg bg-stone-900/70 px-3 py-2">
            <span class="text-stone-300">${escapeHtml(this.pingLabel(key))}</span>
            <span class="text-amber-400 font-semibold">${count.toLocaleString()}</span>
          </div>`).join("")
      } else {
        html += `<div class="rounded-lg bg-stone-900/70 px-3 py-2 text-stone-500 text-sm">No breakdown available</div>`
      }
      html += `</div>`
    }
    if (list.length > 0) {
      html += `<p class="mb-2 text-sm font-medium text-stone-400">Most played with (${list.length})</p>` + list.map((r, i) => {
        const name = escapeHtml(r.teammate_name || r.teammate_riot_id || "Unknown")
        return `
        <div class="flex items-center justify-between rounded-lg bg-stone-900/70 px-3 py-2">
          <span class="font-medium text-stone-300">#${i + 1} ${name}</span>
          <div class="flex-1 mx-3 text-right">
            <span class="text-amber-400 font-semibold">${r.games} games</span>
            <span class="text-stone-500 text-sm"> • ${r.wins_together} wins together</span>
          </div>
        </div>
      `
      }).join("")
    }
    if (enemies.length > 0) {
      html += `<p class="mb-2 mt-4 text-sm font-medium text-stone-400">Enemies who beat you (${enemies.length})</p>` + enemies.map((r, i) => {
        const name = escapeHtml(r.enemy_name || r.enemy_riot_id || "Unknown")
        return `
        <div class="flex items-center justify-between rounded-lg bg-red-900/20 px-3 py-2">
          <span class="font-medium text-stone-300">#${i + 1} ${name}</span>
          <span class="text-red-400 font-semibold">${r.times_beat_us}× beat you</span>
        </div>
      `
      }).join("")
    }
    if (list.length === 0 && enemies.length === 0 && totalPings === 0 && totalGameSeconds === 0 && totalGoldSpent === 0 && favItems.length === 0 && extraEntries.length === 0 && ourTeamBans.length === 0 && enemyTeamBans.length === 0 && totalKills === 0 && totalDeaths === 0 && totalAssists === 0) {
      html = '<p class="text-stone-500 text-sm">No recap data for this year.</p>'
    }

    this.recapResultsTarget.innerHTML = html
    this.recapResultsTarget.classList.remove("hidden")
  }

  showMessage(text, type) {
    if (!this.hasMessageTarget) return
    this.messageTarget.textContent = text
    this.messageTarget.className = "text-sm " + (type === "success" ? "text-amber-400" : type === "error" ? "text-red-400" : "text-stone-400")
    this.messageTarget.classList.toggle("hidden", !text)
  }

  setButtonLoading(action, loading) {
    if (action === "generate" && this.hasGenerateButtonTarget) {
      this.generateButtonTarget.disabled = loading
      this.generateButtonTarget.textContent = loading ? "Generating…" : "Generate recap"
    }
    if (action === "view" && this.hasViewButtonTarget) {
      this.viewButtonTarget.disabled = loading
      this.viewButtonTarget.textContent = loading ? "Loading…" : "View recap"
    }
  }
}
