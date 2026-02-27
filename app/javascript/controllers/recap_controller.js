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

// Escapes a value for safe display (handles numbers and strings).
function safeDisplay(val) {
  if (val == null) return "0"
  const n = Number(val)
  return Number.isNaN(n) ? escapeHtml(String(val)) : String(Math.floor(n))
}

// Sanitizes a string for use in a URL path segment (prevents javascript: and path traversal).
function safeUrlSegment(str) {
  if (str == null || str === "") return "0"
  const s = String(str).replace(/[^a-zA-Z0-9_-]/g, "")
  return s.length > 0 ? s : "0"
}

// Allowed hostnames for profile icon URLs (Riot Data Dragon, Community Dragon).
const SAFE_IMG_HOSTS = ["ddragon.leagueoflegends.com", "raw.communitydragon.org"]

// Returns URL only if it's a safe https URL from a whitelisted host. Prevents XSS via javascript:, data:, etc.
function safeProfileIconUrl(url) {
  if (!url || typeof url !== "string") return ""
  const s = url.trim()
  if (!s) return ""
  try {
    const u = new URL(s)
    if (u.protocol !== "https:") return ""
    if (!SAFE_IMG_HOSTS.includes(u.hostname.toLowerCase())) return ""
    return s
  } catch {
    return ""
  }
}

function recapYear() {
  return new Date().getFullYear() - 1
}

// Connects to data-controller="recap"
// Triggers year recap ingestion and can show recap results
export default class extends Controller {
  static values = {
    ingestUrl: String,
    computeUrl: String,
    recapUrl: String,
    statusUrl: String,
    playerId: Number,
    recapStatuses: Object,
    recapFailureReasons: Object,
    ingestProgress: Object,
    playerRiotId: String,
    profileIconUrl: String,
    autoload: Boolean,
    backUrl: String
  }

  static targets = ["generateButton", "viewButton", "computeButton", "message", "progressBlock", "progressSpinner", "progressContent", "wrappedModal", "cardsContainer"]

  async connect() {
    await this.refreshRecapStatus()
    this.updateStatusDisplay()
    if (this.autoloadValue && this.recapUrlValue) {
      this.loadRecapOnPage()
    }
  }

  async loadRecapOnPage() {
    const year = recapYear()
    const url = this.recapUrlValue.replace("YEAR", year)
    if (this.hasViewButtonTarget) this.viewButtonTarget.textContent = "Loading…"
    if (this.hasMessageTarget) {
      this.messageTarget.textContent = "Loading recap…"
      this.messageTarget.classList.remove("hidden")
    }
    try {
      const response = await fetch(url, { headers: { "Accept": "application/json" } })
      const contentType = response.headers.get("content-type") || ""
      let data = {}
      if (contentType.includes("application/json")) {
        data = await response.json().catch(() => ({}))
      } else if (!response.ok) {
        this.showMessage(`Recap failed (${response.status}). Try again later.`, "error")
        return
      }
      const hasExtraStats = data.extra_stats && (Object.values(data.extra_stats).some((v) => v != null && typeof v === "number" && v > 0) || (data.extra_stats.playstyleIdentity && Object.keys(data.extra_stats.playstyleIdentity || {}).length > 0) || (data.extra_stats.clutchChaosMoments && Object.keys(data.extra_stats.clutchChaosMoments || {}).length > 0) || (data.extra_stats.economyScaling && Object.keys(data.extra_stats.economyScaling || {}).length > 0) || (data.extra_stats.championPersonality && Object.keys(data.extra_stats.championPersonality || {}).length > 0) || (data.extra_stats.visionMapIq && Object.keys(data.extra_stats.visionMapIq || {}).length > 0) || (data.extra_stats.damageProfile && Object.keys(data.extra_stats.damageProfile || {}).length > 0) || (data.extra_stats.botLaneSynergy && Object.keys(data.extra_stats.botLaneSynergy || {}).length > 0) || (Array.isArray(data.extra_stats.memeTitles) && data.extra_stats.memeTitles.length > 0))
      const hasBans = (data.our_team_bans?.length ?? 0) > 0 || (data.enemy_team_bans?.length ?? 0) > 0
      const hasKda = (data.total_kills ?? 0) > 0 || (data.total_deaths ?? 0) > 0 || (data.total_assists ?? 0) > 0
      if (response.ok && (data.most_played_with?.length || data.most_beat_us?.length || (data.total_pings ?? 0) > 0 || (data.total_game_seconds ?? 0) > 0 || (data.total_gold_spent ?? 0) > 0 || (data.fav_items?.length ?? 0) > 0 || hasExtraStats || hasBans || hasKda)) {
        const champNames = await this.fetchChampionNames()
        this.renderWrappedCards(data, year, champNames)
        if (this.hasWrappedModalTarget) {
          this.wrappedModalTarget.classList.remove("hidden")
          this.wrappedModalTarget.setAttribute("aria-hidden", "false")
        }
        if (this.hasMessageTarget) this.showMessage("", "")
      } else {
        this.showMessage(data.error || "No recap data for this year. Generate a recap from your profile first.", "error")
      }
    } catch (err) {
      this.showMessage("Failed to load recap: " + (err?.message || "network error"), "error")
    } finally {
      if (this.hasViewButtonTarget) this.viewButtonTarget.textContent = "View recap"
    }
  }

  async refreshRecapStatus() {
    if (!this.statusUrlValue) return
    try {
      const response = await fetch(this.statusUrlValue, { headers: { "Accept": "application/json" } })
      if (response.ok) {
        const data = await response.json().catch(() => ({}))
        if (data.recap_statuses) this.recapStatusesValue = data.recap_statuses
        if (data.recap_failure_reasons) this.recapFailureReasonsValue = data.recap_failure_reasons
        else this.recapFailureReasonsValue = {}
        if (data.ingest_progress) this.ingestProgressValue = data.ingest_progress
        else this.ingestProgressValue = {}
      }
    } catch (_err) {
      // ignore network errors, fall back to embedded statuses
    }
  }

  disconnect() {
    this.stopPolling()
  }

  startPollingIfGenerating() {
    this.stopPolling()
    const statuses = this.recapStatusesValue || {}
    const year = recapYear()
    if (statuses[String(year)] === "generating") {
      this.pollForReady(year) // Check immediately on page load
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
    // Fetch recap_statuses first for progress updates
    if (this.statusUrlValue) {
      try {
        const statusRes = await fetch(this.statusUrlValue, { headers: { "Accept": "application/json" } })
        if (statusRes.ok) {
          const data = await statusRes.json().catch(() => ({}))
          if (data.recap_statuses) this.recapStatusesValue = data.recap_statuses
          if (data.recap_failure_reasons) this.recapFailureReasonsValue = data.recap_failure_reasons
          else this.recapFailureReasonsValue = {}
          if (data.ingest_progress) this.ingestProgressValue = data.ingest_progress
          else this.ingestProgressValue = {}
          this.updateStatusDisplay()
        }
      } catch (_err) {
        // ignore
      }
    }

    if (!this.recapUrlValue) return
    const url = this.recapUrlValue.replace("YEAR", year)
    try {
      const response = await fetch(url, { headers: { "Accept": "application/json" } })
      if (!response.ok) return
      const data = await response.json().catch(() => ({}))
      const hasData = (data.most_played_with?.length || data.most_beat_us?.length || (data.total_pings ?? 0) > 0 || (data.total_game_seconds ?? 0) > 0 || (data.total_gold_spent ?? 0) > 0 || (data.fav_items?.length ?? 0) > 0) ||
        (data.extra_stats && (Object.values(data.extra_stats).some((v) => v != null && typeof v === "number" && v > 0) || (data.extra_stats.playstyleIdentity && Object.keys(data.extra_stats.playstyleIdentity || {}).length > 0) || (data.extra_stats.clutchChaosMoments && Object.keys(data.extra_stats.clutchChaosMoments || {}).length > 0) || (data.extra_stats.economyScaling && Object.keys(data.extra_stats.economyScaling || {}).length > 0) || (data.extra_stats.championPersonality && Object.keys(data.extra_stats.championPersonality || {}).length > 0) || (data.extra_stats.visionMapIq && Object.keys(data.extra_stats.visionMapIq || {}).length > 0) || (data.extra_stats.damageProfile && Object.keys(data.extra_stats.damageProfile || {}).length > 0) || (data.extra_stats.botLaneSynergy && Object.keys(data.extra_stats.botLaneSynergy || {}).length > 0) || (Array.isArray(data.extra_stats.memeTitles) && data.extra_stats.memeTitles.length > 0))) ||
        (data.our_team_bans?.length ?? 0) > 0 || (data.enemy_team_bans?.length ?? 0) > 0 ||
        (data.total_kills ?? 0) > 0 || (data.total_deaths ?? 0) > 0 || (data.total_assists ?? 0) > 0
      if (hasData) {
        this.stopPolling()
        if (this.element?.isConnected) {
          this.recapStatusesValue = { ...(this.recapStatusesValue || {}), [year]: "ready" }
          this.updateStatusDisplay()
          this.showMessage("Recap is ready! Click \"View recap\" to see it.", "success")
        }
      }
    } catch (_err) {
      // ignore network errors, will retry next poll
    }
  }

  updateStatusDisplay() {
    const statuses = this.recapStatusesValue || {}
    const year = recapYear()
    const status = statuses[String(year)]
    const isGenerating = status === "generating"
    const isFailed = status === "failed"

    const hasRecap = statuses[String(year)] === "ready"
    this.updateButtonState("generate", isGenerating, "Generating…", hasRecap ? "Regenerate recap" : "Generate recap")
    this.updateButtonState("view", isGenerating, "Please wait…", "View recap")
    this.updateButtonState("compute", isGenerating, "Computing…", "Compute")

    if (isGenerating) {
      this.updateProgressBlock()
      this.showMessage("", "")
      if (!this.pollInterval) this.startPollingIfGenerating()
    } else {
      this.hideProgressBlock()
      this.stopPolling()
    }
    if (isFailed) {
      const reasons = this.recapFailureReasonsValue || {}
      const reason = reasons[String(year)] || reasons[year]
      const msg = reason
        ? `Recap generation failed: ${reason} You can try again.`
        : "Recap generation failed for this year. You can try again."
      this.showMessage(msg, "error")
    }
  }

  updateProgressBlock() {
    if (!this.hasProgressBlockTarget || !this.hasProgressContentTarget) return
    const progress = this.ingestProgressValue || {}
    const phase = progress.phase || progress["phase"]
    const queuePosition = progress.queue_position ?? progress["queue_position"]
    const processed = progress.processed ?? progress["processed"]
    const downloaded = progress.downloaded ?? progress["downloaded"]

    const lines = []
    if (phase === "computing") {
      lines.push("Computing your recap…")
    } else if (phase === "downloading") {
      if (queuePosition != null) {
        if (queuePosition > 0) {
          lines.push(queuePosition === 1 ? "You're next!" : `Position in queue: ${queuePosition}`)
        } else {
          lines.push("Your recap is being generated…")
        }
      } else if (lines.length === 0) {
        // Queue position unknown but we're in downloading phase – likely waiting in queue
        lines.push("Waiting in queue…")
      }
      if (processed != null && processed >= 0) {
        const dl = downloaded != null && downloaded >= 0 ? downloaded : 0
        if (dl > 0) {
          lines.push(`Processed ${processed} matches, ${dl} from ${recapYear()}…`)
        } else {
          lines.push(`Processed ${processed} matches (scanning for ${recapYear()})…`)
        }
      } else if (downloaded != null && downloaded >= 0) {
        lines.push(downloaded === 0 ? `Scanning your match history for ${recapYear()}…` : `Downloaded ${downloaded} matches…`)
      }
      if (lines.length === 0) {
        lines.push(`Contacting Riot to get all your games from ${recapYear()}…`)
      }
    } else {
      lines.push(`Contacting Riot to get all your games from ${recapYear()}…`)
    }

    this.progressContentTarget.innerHTML = lines.map((line) => `<p class="text-white">${escapeHtml(line)}</p>`).join("")
    this.progressBlockTarget.classList.remove("hidden")
    if (this.hasProgressSpinnerTarget) {
      const showSpinner = phase === "downloading" || phase === "computing"
      this.progressSpinnerTarget.classList.toggle("hidden", !showSpinner)
    }
  }

  hideProgressBlock() {
    if (this.hasProgressBlockTarget) {
      this.progressBlockTarget.classList.add("hidden")
    }
    if (this.hasProgressSpinnerTarget) {
      this.progressSpinnerTarget.classList.add("hidden")
    }
  }

  buildGeneratingMessage() {
    const progress = this.ingestProgressValue || {}
    const phase = progress.phase || progress["phase"]
    const queuePosition = progress.queue_position ?? progress["queue_position"]
    const processed = progress.processed ?? progress["processed"]
    const downloaded = progress.downloaded ?? progress["downloaded"]

    if (phase === "computing") {
      return "Computing your recap…"
    }
    if (phase === "downloading") {
      const parts = []
      if (queuePosition != null && queuePosition > 0) {
        parts.push(queuePosition === 1 ? "You're next!" : `Position in queue: ${queuePosition}`)
      }
      if (processed != null && processed >= 0) {
        const dl = downloaded != null && downloaded >= 0 ? downloaded : 0
        parts.push(dl > 0 ? `Processed ${processed} matches, ${dl} from ${recapYear()}` : `Processed ${processed} matches (scanning for ${recapYear()})`)
      } else if (downloaded != null && downloaded >= 0) {
        parts.push(downloaded === 0 ? `Scanning for ${recapYear()}…` : `Downloaded ${downloaded} matches`)
      }
      if (parts.length > 0) return parts.join(" • ")
      return `Contacting Riot to get all your games from ${recapYear()}…`
    }
    return `Contacting Riot to get all your games from ${recapYear()}…`
  }

  updateButtonState(name, disabled, disabledText, normalText) {
    const targetMap = { generate: "generateButton", view: "viewButton", compute: "computeButton" }
    const targetName = targetMap[name]
    if (!this[`has${targetName.charAt(0).toUpperCase() + targetName.slice(1)}Target`]) return

    const btn = this[`${targetName}Target`]
    const isLink = btn.tagName === "A"
    if (isLink) {
      btn.classList.toggle("pointer-events-none", disabled)
      btn.classList.toggle("opacity-75", disabled)
    } else {
      btn.disabled = disabled
    }
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
    this.generating = true
    this.setButtonLoading("generate", true)
    this.showMessage("", "")

    const year = recapYear()
    const statuses = this.recapStatusesValue || {}
    const status = statuses[String(year)]
    const force = status === "ready" || status === "failed" // allow retry after failure or regenerate
    let success = false
    try {
      const response = await fetch(this.ingestUrlValue, {
        method: "POST",
        headers: {
          "Accept": "application/json",
          "Content-Type": "application/json",
          "X-CSRF-Token": document.querySelector("[name='csrf-token']")?.content
        },
        body: JSON.stringify({ year: parseInt(year, 10), force })
      })

      const data = await response.json().catch(() => ({}))
      if (response.status === 202) {
        success = true
        if (data.recap_statuses) this.recapStatusesValue = data.recap_statuses
        if (data.ingest_progress) this.ingestProgressValue = data.ingest_progress
        await this.refreshRecapStatus()
        this.updateStatusDisplay()
      } else {
        this.showMessage(data.error || "Failed to start recap generation", "error")
      }
    } catch (err) {
      this.showMessage("Failed to start recap generation", "error")
    } finally {
      this.generating = false
      if (!success) this.setButtonLoading("generate", false)
      this.updateStatusDisplay()
    }
  }

  async compute(event) {
    event.preventDefault()
    if (!this.computeUrlValue) return

    const year = recapYear()
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

  navigateToRecap(event) {
    const statuses = this.recapStatusesValue || {}
    const year = recapYear()
    if (statuses[String(year)] === "generating") {
      event.preventDefault()
    }
  }

  async viewRecap(event) {
    event.preventDefault()
    if (!this.recapUrlValue) return

    const year = recapYear()
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
      const hasExtraStats = data.extra_stats && (Object.values(data.extra_stats).some((v) => v != null && typeof v === "number" && v > 0) || (data.extra_stats.playstyleIdentity && Object.keys(data.extra_stats.playstyleIdentity || {}).length > 0) || (data.extra_stats.clutchChaosMoments && Object.keys(data.extra_stats.clutchChaosMoments || {}).length > 0) || (data.extra_stats.economyScaling && Object.keys(data.extra_stats.economyScaling || {}).length > 0) || (data.extra_stats.championPersonality && Object.keys(data.extra_stats.championPersonality || {}).length > 0) || (data.extra_stats.visionMapIq && Object.keys(data.extra_stats.visionMapIq || {}).length > 0) || (data.extra_stats.damageProfile && Object.keys(data.extra_stats.damageProfile || {}).length > 0) || (data.extra_stats.botLaneSynergy && Object.keys(data.extra_stats.botLaneSynergy || {}).length > 0) || (Array.isArray(data.extra_stats.memeTitles) && data.extra_stats.memeTitles.length > 0))
      const hasBans = (data.our_team_bans?.length ?? 0) > 0 || (data.enemy_team_bans?.length ?? 0) > 0
      const hasKda = (data.total_kills ?? 0) > 0 || (data.total_deaths ?? 0) > 0 || (data.total_assists ?? 0) > 0
      if (response.ok && (data.most_played_with?.length || data.most_beat_us?.length || (data.total_pings ?? 0) > 0 || (data.total_game_seconds ?? 0) > 0 || (data.total_gold_spent ?? 0) > 0 || (data.fav_items?.length ?? 0) > 0 || hasExtraStats || hasBans || hasKda)) {
        this.recapStatusesValue = { ...(this.recapStatusesValue || {}), [year]: "ready" }
        this.updateStatusDisplay()
        this.showMessage("", "")
        const champNames = await this.fetchChampionNames()
        this.renderWrappedCards(data, year, champNames)
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

  async fetchChampionNames() {
    try {
      const res = await fetch("https://ddragon.leagueoflegends.com/cdn/16.4.1/data/en_US/champion.json")
      const json = await res.json().catch(() => ({}))
      const map = {}
      const data = json.data || {}
      for (const champ of Object.values(data)) {
        if (champ && champ.key) map[String(champ.key)] = champ.name || champ.id
      }
      return map
    } catch {
      return {}
    }
  }

  formatGameTime(seconds) {
    if (!seconds || seconds <= 0) return "0h"
    const h = Math.floor(seconds / 3600)
    const m = Math.floor((seconds % 3600) / 60)
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

  renderWrappedCards(data, year, champNames = {}) {
    if (!this.hasCardsContainerTarget || !this.hasWrappedModalTarget) return

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
    const playerRiotId = this.playerRiotIdValue || data.player_riot_id || ""
    const ITEM_IMG_BASE = "https://ddragon.leagueoflegends.com/cdn/16.4.1/img/item"
    const CHAMP_IMG_DDRAGON = "https://ddragon.leagueoflegends.com/cdn/16.4.1/img/champion"
    const CHAMP_IMG_CDRAGON = "https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global/default/v1/champion-icons"

    const cards = []

    if (playerRiotId || year) {
      const profileIconUrl = this.profileIconUrlValue || data.profile_icon_url || ""
      cards.push({ type: "intro", html: this.cardIntro(playerRiotId, year, profileIconUrl) })
    }
    const mostPopularQueue = extraStats.mostPopularQueueType || extraStats["mostPopularQueueType"]
    const queueDistribution = extraStats.queueDistribution || extraStats["queueDistribution"]
    let queueCard = null
    if (mostPopularQueue?.type && (mostPopularQueue.games ?? 0) > 0) {
      queueCard = this.cardMostPopularQueueType(mostPopularQueue, queueDistribution)
    } else if (queueDistribution && Object.keys(queueDistribution).length > 0) {
      const top = Object.entries(queueDistribution).filter(([k]) => k !== "other").sort((a, b) => b[1] - a[1])[0]
      const derived = top ? { type: top[0], games: top[1] } : null
      queueCard = this.cardMostPopularQueueType(derived || { type: "other", games: Object.values(queueDistribution).reduce((a, b) => a + Number(b), 0) }, queueDistribution)
    }
    const totalGames = queueDistribution && typeof queueDistribution === "object"
      ? Object.values(queueDistribution).reduce((a, b) => a + (Number(b) || 0), 0)
      : 0
    const timeByQueue = extraStats.timeByQueue || extraStats["timeByQueue"] || extraStats.time_by_queue || extraStats["time_by_queue"]
    const timeCard = totalGameSeconds > 0 ? this.cardTime(totalGameSeconds, totalGames, timeByQueue) : null
    if (queueCard || timeCard) {
      const left = queueCard || { header: "", chart: "" }
      const right = timeCard || { header: "", chart: "" }
      const content = queueCard && timeCard
        ? `<div class="grid w-full max-w-2xl grid-cols-1 gap-y-4 md:grid-cols-2 md:gap-x-12 md:gap-y-6 md:items-start">
  <div class="flex flex-col items-center text-center">${left.header}</div>
  <div class="flex flex-col items-center text-center">${right.header}</div>
  <div class="flex flex-col items-center gap-5">${left.chart}</div>
  <div class="flex flex-col items-center gap-5">${right.chart}</div>
</div>`
        : (() => { const c = queueCard || timeCard; const chart = c.chart ? `<div class="mt-6 flex flex-col items-center gap-5">${c.chart}</div>` : ""; return `<div class="flex w-full max-w-2xl flex-col items-center text-center">${c.header}${chart}</div>` })()
      cards.push({ type: "queueAndTime", html: content })
    }
    const championPersonality = extraStats.championPersonality || extraStats["championPersonality"]
    if (championPersonality && this.hasChampionPersonalityData(championPersonality)) {
      cards.push({ type: "championPersonality", html: this.cardChampionPersonality(championPersonality, CHAMP_IMG_DDRAGON, CHAMP_IMG_CDRAGON, champNames) })
    }
    if (totalKills > 0 || totalDeaths > 0 || totalAssists > 0) {
      cards.push({ type: "kda", html: this.cardKda(totalKills, totalDeaths, totalAssists) })
    }
    const totalLastHits = Number(extraStats.totalLastHits ?? extraStats["totalLastHits"] ?? 0) || 0
    const avgCsPerMin = Number(extraStats.avgCsPerMin ?? extraStats["avgCsPerMin"]) || null
    if (totalGoldSpent > 0 || totalLastHits > 0 || (avgCsPerMin != null && avgCsPerMin > 0)) {
      cards.push({ type: "economy", html: this.cardGoldAndLastHits(totalGoldSpent, totalLastHits, avgCsPerMin) })
    }
    const playstyleIdentity = extraStats.playstyleIdentity || extraStats["playstyleIdentity"]
    if (playstyleIdentity && this.hasPlaystyleIdentityData(playstyleIdentity)) {
      cards.push({ type: "playstyle", html: this.cardPlaystyleIdentity(playstyleIdentity) })
    }
    const clutchChaos = extraStats.clutchChaosMoments || extraStats["clutchChaosMoments"]
    if (clutchChaos && this.hasClutchChaosData(clutchChaos)) {
      cards.push({ type: "clutch", html: this.cardClutchChaos(clutchChaos) })
    }
    const economyScaling = extraStats.economyScaling || extraStats["economyScaling"]
    if (economyScaling && this.hasEconomyScalingData(economyScaling)) {
      cards.push({ type: "economyScaling", html: this.cardEconomyScaling(economyScaling) })
    }
    const visionMapIq = extraStats.visionMapIq || extraStats["visionMapIq"]
    if (visionMapIq && this.hasVisionMapIqData(visionMapIq)) {
      cards.push({ type: "visionMapIq", html: this.cardVisionMapIq(visionMapIq) })
    }
    const damageProfile = extraStats.damageProfile || extraStats["damageProfile"]
    if (damageProfile && this.hasDamageProfileData(damageProfile)) {
      cards.push({ type: "damageProfile", html: this.cardDamageProfile(damageProfile) })
    }
    const botLaneSynergy = extraStats.botLaneSynergy || extraStats["botLaneSynergy"]
    if (botLaneSynergy && this.hasBotLaneSynergyData(botLaneSynergy)) {
      cards.push({ type: "botLaneSynergy", html: this.cardBotLaneSynergy(botLaneSynergy) })
    }
    const memeTitles = extraStats.memeTitles || extraStats["memeTitles"]
    if (memeTitles && Array.isArray(memeTitles) && memeTitles.length > 0) {
      cards.push({ type: "memeTitles", html: this.cardMemeTitles(memeTitles) })
    }
    if (list.length > 0) {
      cards.push({ type: "teammates", html: this.cardTeammates(list) })
    }
    if (enemies.length > 0) {
      cards.push({ type: "nemesis", html: this.cardNemesis(enemies) })
    }
    if (favItems.length > 0) {
      cards.push({ type: "items", html: this.cardItems(favItems, ITEM_IMG_BASE) })
    }
    if (ourTeamBans.length > 0 || enemyTeamBans.length > 0) {
      cards.push({ type: "bans", html: this.cardBans(ourTeamBans, enemyTeamBans, CHAMP_IMG_DDRAGON, CHAMP_IMG_CDRAGON) })
    }
    if (totalPings > 0) {
      cards.push({ type: "pings", html: this.cardPings(totalPings, pingBreakdown) })
    }
    const extraEntries = Object.entries(extraStats).filter(
      ([key, v]) => !["totalLastHits", "avgCsPerMin", "playstyleIdentity", "clutchChaosMoments", "economyScaling", "championPersonality", "visionMapIq", "damageProfile", "botLaneSynergy", "memeTitles", "mostPopularQueueType", "queueDistribution", "timeByQueue", "time_by_queue"].includes(key) && v != null && v !== "" && Number(v) > 0
    )
    if (extraEntries.length > 0) {
      cards.push({ type: "extra", html: this.cardExtra(extraEntries) })
    }

    if (cards.length === 0) {
      cards.push({ type: "empty", html: '<p class="text-stone-500 text-lg">No recap data for this year.</p>' })
    }

    this.cardsContainerTarget.innerHTML = cards.map((c) =>
      `<div class="wrapped-card flex min-w-full flex-shrink-0 snap-start snap-always items-center justify-center p-8" role="group" aria-roledescription="slide">
        <div class="flex max-w-lg flex-col items-center text-center">${c.html}</div>
      </div>`
    ).join("")

    this.wrappedModalTarget.classList.remove("hidden")
    this.wrappedModalTarget.setAttribute("aria-hidden", "false")

    this.boundEscape = (e) => {
      if (e.key === "Escape") this.closeWrapped()
    }
    document.addEventListener("keydown", this.boundEscape)

    const wrappedController = this.application.getControllerForElementAndIdentifier(
      this.cardsContainerTarget.closest("[data-controller*='wrapped-cards']"),
      "wrapped-cards"
    )
    wrappedController?.refresh()
  }

  cardIntro(playerRiotId, year, profileIconUrl) {
    const initial = (playerRiotId || "S").charAt(0).toUpperCase()
    const safeUrl = safeProfileIconUrl(profileIconUrl)
    const avatarHtml = safeUrl
      ? `<img src="${escapeHtml(safeUrl)}" alt="" class="h-full w-full object-cover" onerror="this.classList.add('hidden');this.nextElementSibling.classList.remove('hidden')"><span class="hidden text-6xl font-bold text-white">${escapeHtml(initial)}</span>`
      : `<span class="text-6xl font-bold text-white">${escapeHtml(initial)}</span>`
    return `
      <p class="text-3xl font-medium uppercase tracking-widest text-white">Your ${escapeHtml(String(year))} LoL Wrapped</p>
      <div class="my-8 flex h-40 w-40 shrink-0 items-center justify-center overflow-hidden rounded-full bg-stone-500/30">
        ${avatarHtml}
      </div>
      <h2 class="text-5xl font-bold text-white">${escapeHtml(playerRiotId || "Summoner")}</h2>
      <p class="mt-6 text-lg text-stone-400">Swipe to see your stats</p>
    `
  }

  cardMostPopularQueueType(data, queueDistribution) {
    const labels = {
      ranked_solo: { name: "The Ladder Climber", queue: "Ranked Solo Duo", color: "#60a5fa", bgClass: "bg-blue-400" },
      ranked_flex: { name: "The Premade Professor", queue: "Ranked Flex", color: "#a78bfa", bgClass: "bg-violet-400" },
      normal_draft: { name: "The Low-Stakes Legend", queue: "Normal Draft", color: "#34d399", bgClass: "bg-emerald-400" },
      blind_pick: { name: "Role Roulette Survivor", queue: "Blind Pick", color: "#fbbf24", bgClass: "bg-amber-400" },
      aram: { name: "The Bridge Brawler", queue: "ARAM", color: "#f87171", bgClass: "bg-red-400" },
      clash: { name: "The Trophy Chaser", queue: "Clash", color: "#f472b6", bgClass: "bg-pink-400" },
      urf_rgm: { name: "The Funmaxxer", queue: "URF / RGM", color: "#22d3ee", bgClass: "bg-cyan-400" },
      custom: { name: "The Scrim Scholar", queue: "Custom Games", color: "#94a3b8", bgClass: "bg-slate-400" },
      other: { name: "Queue Enthusiast", queue: "Other", color: "#64748b", bgClass: "bg-slate-500" }
    }
    const t = data?.type || ""
    const info = labels[t] || { name: "Queue Enthusiast", queue: (t || "other").replace(/_/g, " "), color: "#64748b", bgClass: "bg-slate-500" }
    const games = safeDisplay(data?.games ?? 0)

    let chartHtml = ""
    if (queueDistribution && typeof queueDistribution === "object" && Object.keys(queueDistribution).length > 0) {
      const entries = Object.entries(queueDistribution).map(([k, v]) => [k, Number(v) || 0]).filter(([, v]) => v > 0)
      const total = entries.reduce((s, [, v]) => s + v, 0)
      if (total > 0) {
        const sorted = entries.sort((a, b) => b[1] - a[1])
        const size = 160
        const cx = size / 2
        const cy = size / 2
        const rOuter = (size / 2) - 4
        const rInner = rOuter * 0.55
        const gapDeg = 1.5
        let acc = 0
        const totalDeg = 360 - gapDeg * sorted.length
        const paths = sorted.map(([k, v]) => {
          const pct = (v / total) * totalDeg
          const startAngle = acc - 90
          const endAngle = acc + pct - 90
          acc += pct + gapDeg
          const rad = (deg) => (deg * Math.PI) / 180
          const x1 = cx + rOuter * Math.cos(rad(startAngle))
          const y1 = cy + rOuter * Math.sin(rad(startAngle))
          const x2 = cx + rOuter * Math.cos(rad(endAngle))
          const y2 = cy + rOuter * Math.sin(rad(endAngle))
          const x3 = cx + rInner * Math.cos(rad(endAngle))
          const y3 = cy + rInner * Math.sin(rad(endAngle))
          const x4 = cx + rInner * Math.cos(rad(startAngle))
          const y4 = cy + rInner * Math.sin(rad(startAngle))
          const large = pct > 50 ? 1 : 0
          const d = `M ${x1} ${y1} A ${rOuter} ${rOuter} 0 ${large} 1 ${x2} ${y2} L ${x3} ${y3} A ${rInner} ${rInner} 0 ${large} 0 ${x4} ${y4} Z`
          const c = (labels[k] || { color: "#64748b" }).color
          return `<path d="${d}" fill="${escapeHtml(c)}" stroke="rgba(15,23,42,0.9)" stroke-width="2"/>`
        }).join("")
        const legendItems = sorted.map(([k, v]) => {
          const pct = ((100 * v) / total).toFixed(1)
          const li = labels[k] || { queue: k.replace(/_/g, " "), color: "#64748b" }
          const bg = (labels[k] || { bgClass: "bg-slate-500" }).bgClass
          return `<li class="flex items-center gap-3 rounded-md px-2 py-1.5"><span class="h-3 w-3 shrink-0 rounded-sm ${escapeHtml(bg)}"></span><span class="flex-1 text-white text-sm">${escapeHtml(li.queue)}</span><span class="text-white text-sm tabular-nums">${escapeHtml(String(v))} (${escapeHtml(pct)}%)</span></li>`
        }).join("")
        chartHtml = `
        <div class="relative">
          <svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" class="drop-shadow-lg" aria-hidden="true">
            ${paths}
          </svg>
          <div class="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div class="flex flex-col items-center">
              <span class="text-3xl font-bold tabular-nums text-white tracking-tight">${escapeHtml(String(total))}</span>
              <span class="text-xs font-medium uppercase tracking-wider text-white mt-0.5">games</span>
            </div>
          </div>
        </div>
        <ul class="flex w-full max-w-sm flex-col gap-0.5">${legendItems}</ul>`
      }
    }

    const headerHtml = `
      <p class="text-2xl font-bold text-white">${escapeHtml(info.name)}</p>
      <p class="mt-2 text-lg text-white">Your most popular game was: ${escapeHtml(info.queue)}</p>
      <p class="mt-2 text-lg text-white">${escapeHtml(games)} games this year</p>`
    return { header: headerHtml, chart: chartHtml }
  }

  cardKda(k, d, a) {
    const kNum = Number(k) || 0
    const dNum = Number(d) || 0
    const aNum = Number(a) || 0
    const kdaValue = dNum > 0 ? (kNum + aNum) / dNum : Infinity
    const kdaRatio = dNum > 0 ? kdaValue.toFixed(1) : "∞"
    let title = ""
    if (kdaValue > 3) title = "The Untouchable"
    else if (kdaValue < 1.5 && dNum > 0) title = "Donation Center"
    else if (dNum > 0) title = "Respectably Alive"
    return `
      <p class="text-xs font-medium uppercase tracking-widest text-stone-500">K/D/A (all games)</p>
      ${title ? `<p class="mt-2 text-xl font-bold text-white">${escapeHtml(title)}</p>` : ""}
      <div class="mt-4 flex gap-6">
        <div><span class="block text-4xl font-bold text-green-500">${kNum.toLocaleString()}</span><span class="text-stone-500">Kills</span></div>
        <div><span class="block text-4xl font-bold text-red-500">${dNum.toLocaleString()}</span><span class="text-stone-500">Deaths</span></div>
        <div><span class="block text-4xl font-bold text-white">${aNum.toLocaleString()}</span><span class="text-stone-500">Assists</span></div>
      </div>
      <p class="mt-4 text-lg font-semibold text-stone-400">KDA ${escapeHtml(kdaRatio)}</p>
    `
  }

  cardGoldAndLastHits(gold, lastHits, avgCsPerMin) {
    const goldNum = Number(gold) || 0
    const lastHitsNum = Number(lastHits) || 0
    const csPerMin = avgCsPerMin != null && Number(avgCsPerMin) > 0 ? Number(avgCsPerMin) : null
    let title = ""
    if (csPerMin != null) {
      if (csPerMin < 4) title = "CS Optional"
      else if (csPerMin < 6) title = "Respectable Farmer"
      else if (csPerMin < 8) title = "Creep Connoisseur"
      else title = "Macro Merchant"
    }
    return `
      <p class="text-xs font-medium uppercase tracking-widest text-stone-500">Economy</p>
      ${title ? `<p class="mt-2 text-xl font-bold text-white">${escapeHtml(title)}</p>` : ""}
      <div class="mt-4 flex flex-wrap justify-center gap-8">
        ${goldNum > 0 ? `
          <div>
            <p class="text-4xl font-bold text-white">${goldNum.toLocaleString()}</p>
            <p class="text-stone-500 text-sm">gold spent</p>
          </div>
        ` : ""}
        ${lastHitsNum > 0 ? `
          <div>
            <p class="text-4xl font-bold text-white">${lastHitsNum.toLocaleString()}</p>
            <p class="text-stone-500 text-sm">last hits</p>
          </div>
        ` : ""}
        ${csPerMin != null ? `
          <div>
            <p class="text-4xl font-bold text-white">${escapeHtml(String(csPerMin))}</p>
            <p class="text-stone-500 text-sm">avg CS/min</p>
          </div>
        ` : ""}
      </div>
    `
  }

  cardTime(seconds, totalGames, timeByQueue) {
    const hours = (Number(seconds) || 0) / 3600
    let title = ""
    if (hours < 10) title = "Casual Summoner"
    else if (hours < 25) title = "Weekend Warrior"
    else if (hours < 75) title = "Consistent Queuer"
    else if (hours < 150) title = "Dedicated Grinder"
    else if (hours < 300) title = "The Climb Enthusiast"
    else if (hours < 600) title = "The Second Job"
    else if (hours < 1000) title = "Summoner's Rift Tenant"
    else title = "The Queue Never Ends"
    const queueLabels = {
      ranked_solo: { queue: "Ranked Solo/Duo", color: "#60a5fa", bgClass: "bg-blue-400" },
      ranked_flex: { queue: "Ranked Flex", color: "#a78bfa", bgClass: "bg-violet-400" },
      normal_draft: { queue: "Normal Draft", color: "#34d399", bgClass: "bg-emerald-400" },
      blind_pick: { queue: "Blind Pick", color: "#fbbf24", bgClass: "bg-amber-400" },
      aram: { queue: "ARAM", color: "#f87171", bgClass: "bg-red-400" },
      clash: { queue: "Clash", color: "#f472b6", bgClass: "bg-pink-400" },
      urf_rgm: { queue: "URF / RGM", color: "#22d3ee", bgClass: "bg-cyan-400" },
      custom: { queue: "Custom", color: "#94a3b8", bgClass: "bg-slate-400" },
      other: { queue: "Other", color: "#64748b", bgClass: "bg-slate-500" }
    }
    let breakdown = ""
    let timeByModeHtml = ""
    if (timeByQueue && typeof timeByQueue === "object" && Object.keys(timeByQueue).length > 0) {
      const entries = Object.entries(timeByQueue)
        .map(([k, v]) => [k, Number(v) || 0])
        .filter(([, v]) => v > 0)
        .sort((a, b) => b[1] - a[1])
      const totalSecs = entries.reduce((s, [, v]) => s + v, 0)
      if (entries.length > 0 && totalSecs > 0) {
        const size = 160
        const cx = size / 2
        const cy = size / 2
        const rOuter = (size / 2) - 4
        const rInner = rOuter * 0.55
        const gapDeg = 1.5
        let acc = 0
        const totalDeg = 360 - gapDeg * entries.length
        const paths = entries.map(([k, v]) => {
          const pct = (v / totalSecs) * totalDeg
          const startAngle = acc - 90
          const endAngle = acc + pct - 90
          acc += pct + gapDeg
          const rad = (deg) => (deg * Math.PI) / 180
          const x1 = cx + rOuter * Math.cos(rad(startAngle))
          const y1 = cy + rOuter * Math.sin(rad(startAngle))
          const x2 = cx + rOuter * Math.cos(rad(endAngle))
          const y2 = cy + rOuter * Math.sin(rad(endAngle))
          const x3 = cx + rInner * Math.cos(rad(endAngle))
          const y3 = cy + rInner * Math.sin(rad(endAngle))
          const x4 = cx + rInner * Math.cos(rad(startAngle))
          const y4 = cy + rInner * Math.sin(rad(startAngle))
          const large = pct > 50 ? 1 : 0
          const d = `M ${x1} ${y1} A ${rOuter} ${rOuter} 0 ${large} 1 ${x2} ${y2} L ${x3} ${y3} A ${rInner} ${rInner} 0 ${large} 0 ${x4} ${y4} Z`
          const c = (queueLabels[k] || { color: "#64748b" }).color
          return `<path d="${d}" fill="${escapeHtml(c)}" stroke="rgba(15,23,42,0.9)" stroke-width="2"/>`
        }).join("")
        const legendItems = entries.map(([k, secs]) => {
          const pct = ((100 * secs) / totalSecs).toFixed(1)
          const li = queueLabels[k] || { queue: k.replace(/_/g, " "), color: "#64748b", bgClass: "bg-slate-500" }
          const hrs = secs / 3600
          const display = hrs >= 1 ? `${hrs.toFixed(1)}h` : `${Math.round(secs / 60)}m`
          return `<li class="flex items-center gap-3 rounded-md px-2 py-1.5"><span class="h-3 w-3 shrink-0 rounded-sm ${escapeHtml(li.bgClass)}"></span><span class="flex-1 text-white text-sm">${escapeHtml(li.queue)}</span><span class="text-white text-sm tabular-nums">${escapeHtml(display)} (${escapeHtml(pct)}%)</span></li>`
        }).join("")
        const centerHours = this.formatGameTime(totalSecs)
        timeByModeHtml = `
        <div class="relative">
          <svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" class="drop-shadow-lg" aria-hidden="true">
            ${paths}
          </svg>
          <div class="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div class="flex flex-col items-center">
              <span class="text-3xl font-bold tabular-nums text-white tracking-tight">${escapeHtml(centerHours)}</span>
              <span class="text-xs font-medium uppercase tracking-wider text-white mt-0.5">hours</span>
            </div>
          </div>
        </div>
        <ul class="flex w-full max-w-sm flex-col gap-0.5">${legendItems}</ul>`
      }
    }
    const headerHtml = `
      <p class="text-xl font-bold text-white">${escapeHtml(title)}</p>
      <p class="mt-4 text-5xl font-bold text-white">${escapeHtml(this.formatGameTime(seconds))}</p>
      <p class="mt-2 text-white">total playtime this year</p>`
    return { header: headerHtml, chart: timeByModeHtml }
  }

  hasPlaystyleIdentityData(pi) {
    if (!pi || typeof pi !== "object") return false
    const mce = pi.mainCharacterEnergy || pi["mainCharacterEnergy"]
    const ggi = pi.goldGoblinIndex || pi["goldGoblinIndex"]
    const rts = pi.riskToleranceScore || pi["riskToleranceScore"]
    const egd = pi.earlyGameDemon || pi["earlyGameDemon"]
    const hasMce = mce && (mce.gamesCount ?? mce["gamesCount"]) > 0
    const hasGgi = ggi && (ggi.avgGoldPerMin ?? ggi["avgGoldPerMin"]) != null
    const hasRts = rts && (rts.avgDeaths ?? rts["avgDeaths"]) != null
    const hasEgd = egd && ((egd.avgTakedownsFirstXMinutes ?? egd["avgTakedownsFirstXMinutes"]) != null || (egd.firstBloodInvolvementPercent ?? egd["firstBloodInvolvementPercent"]) != null)
    return hasMce || hasGgi || hasRts || hasEgd
  }

  cardPlaystyleIdentity(pi) {
    const mce = pi.mainCharacterEnergy || pi["mainCharacterEnergy"] || {}
    const ggi = pi.goldGoblinIndex || pi["goldGoblinIndex"] || {}
    const rts = pi.riskToleranceScore || pi["riskToleranceScore"] || {}
    const egd = pi.earlyGameDemon || pi["earlyGameDemon"] || {}
    const v = (o, k) => (o && o[k]) ?? null
    const sections = []
    if (v(mce, "gamesCount") > 0) {
      const highest = v(mce, "highestTeamDamagePercentage")
      const pct = v(mce, "gamesMostDamagePercent")
      const games = v(mce, "gamesMostDamageOnTeam")
      sections.push(`
        <div class="text-left">
          <p class="text-xs font-semibold uppercase tracking-wide text-white/90">Main Character Energy</p>
          <p class="mt-1 text-stone-300">Peak team damage: <span class="font-bold text-white">${highest != null ? `${Number(highest).toFixed(1)}%` : "—"}</span></p>
          <p class="text-stone-400 text-sm">Most damage on team in ${pct != null ? `${Number(pct).toFixed(0)}%` : "—"} of games (${games ?? 0} games)</p>
        </div>
      `)
    }
    if (v(ggi, "avgGoldPerMin") != null || v(ggi, "gamesTopGoldPercent") != null) {
      const gpm = v(ggi, "avgGoldPerMin")
      const topPct = v(ggi, "gamesTopGoldPercent")
      sections.push(`
        <div class="text-left">
          <p class="text-xs font-semibold uppercase tracking-wide text-white/90">Gold Goblin Index</p>
          <p class="mt-1 text-stone-300">Avg gold/min: <span class="font-bold text-white">${gpm != null ? Number(gpm).toLocaleString() : "—"}</span></p>
          <p class="text-stone-400 text-sm">Top gold on team in ${topPct != null ? `${Number(topPct).toFixed(0)}%` : "—"} of games</p>
        </div>
      `)
    }
    if (v(rts, "avgDeaths") != null || v(rts, "gamesWithZeroDeaths") != null) {
      const avgD = v(rts, "avgDeaths")
      const zeroD = v(rts, "gamesWithZeroDeaths")
      const avgDead = v(rts, "avgTimeSpentDead")
      sections.push(`
        <div class="text-left">
          <p class="text-xs font-semibold uppercase tracking-wide text-white/90">Risk Tolerance Score</p>
          <p class="mt-1 text-stone-300">Avg deaths: <span class="font-bold text-white">${avgD != null ? Number(avgD).toFixed(1) : "—"}</span> • ${zeroD != null ? zeroD : 0} games with 0 deaths</p>
          ${avgDead != null ? `<p class="text-stone-400 text-sm">Avg time spent dead: ${Number(avgDead).toFixed(0)}s</p>` : ""}
        </div>
      `)
    }
    if (v(egd, "avgTakedownsFirstXMinutes") != null || v(egd, "firstBloodInvolvementPercent") != null || v(egd, "avgLaneMinionsFirst10Minutes") != null) {
      const takedowns = v(egd, "avgTakedownsFirstXMinutes")
      const fbPct = v(egd, "firstBloodInvolvementPercent")
      const laneMinions = v(egd, "avgLaneMinionsFirst10Minutes")
      sections.push(`
        <div class="text-left">
          <p class="text-xs font-semibold uppercase tracking-wide text-white/90">Early Game Demon</p>
          <p class="mt-1 text-stone-300">Avg takedowns (first 25 min): <span class="font-bold text-white">${takedowns != null ? Number(takedowns).toFixed(1) : "—"}</span></p>
          <p class="text-stone-400 text-sm">${laneMinions != null ? `Avg CS first 10 min: ${Number(laneMinions).toFixed(1)} • ` : ""}First Blood involvement: ${fbPct != null ? `${Number(fbPct).toFixed(0)}%` : "—"} of games</p>
        </div>
      `)
    }
    if (sections.length === 0) return ""
    return `
      <p class="text-xs font-medium uppercase tracking-widest text-stone-500">Playstyle Identity</p>
      <p class="mt-2 text-lg font-bold text-white">Who you are on the Rift</p>
      <div class="mt-6 flex flex-col gap-4">${sections.join("")}</div>
    `
  }

  hasClutchChaosData(cc) {
    if (!cc || typeof cc !== "object") return false
    const v = (o, k) => (o && o[k]) ?? null
    const oneHp = v(cc.oneHpSurvivor || cc["oneHpSurvivor"], "survivedSingleDigitHpCount")
    const outnum = v(cc.outnumberedFighter || cc["outnumberedFighter"], "outnumberedKills")
    const objThief = v(cc.objectiveThiefPotential || cc["objectiveThiefPotential"], "objectivesStolenPlusAssists")
    const fb = v(cc.firstBloodMagnet || cc["firstBloodMagnet"], "firstBloodInvolvementPercent")
    const surr = cc.surrenderStats || cc["surrenderStats"]
    const surrPct = surr && v(surr, "surrenderGamesPercent")
    return (oneHp != null && Number(oneHp) > 0) || (outnum != null && Number(outnum) > 0) ||
      (objThief != null && Number(objThief) > 0) || (fb != null && Number(fb) > 0) ||
      (surrPct != null && Number(surrPct) > 0)
  }

  cardClutchChaos(cc) {
    const v = (o, k) => (o && o[k]) ?? null
    const oneHp = cc.oneHpSurvivor || cc["oneHpSurvivor"] || {}
    const outnum = cc.outnumberedFighter || cc["outnumberedFighter"] || {}
    const objThief = cc.objectiveThiefPotential || cc["objectiveThiefPotential"] || {}
    const fb = cc.firstBloodMagnet || cc["firstBloodMagnet"] || {}
    const surr = cc.surrenderStats || cc["surrenderStats"] || {}
    const sections = []
    const hpCount = v(oneHp, "survivedSingleDigitHpCount")
    if (hpCount != null && Number(hpCount) > 0) {
      sections.push(`
        <div class="text-left">
          <p class="text-xs font-semibold uppercase tracking-wide text-white/90">1 HP Survivor</p>
          <p class="mt-1 text-stone-300">Survived at &lt;10 HP: <span class="font-bold text-white">${Number(hpCount).toLocaleString()}</span> times</p>
        </div>
      `)
    }
    const kills = v(outnum, "outnumberedKills")
    if (kills != null && Number(kills) > 0) {
      sections.push(`
        <div class="text-left">
          <p class="text-xs font-semibold uppercase tracking-wide text-white/90">Outnumbered Fighter</p>
          <p class="mt-1 text-stone-300">Outnumbered kills: <span class="font-bold text-white">${Number(kills).toLocaleString()}</span></p>
        </div>
      `)
    }
    const stolen = v(objThief, "objectivesStolenPlusAssists")
    if (stolen != null && Number(stolen) > 0) {
      sections.push(`
        <div class="text-left">
          <p class="text-xs font-semibold uppercase tracking-wide text-white/90">Objective Thief Potential</p>
          <p class="mt-1 text-stone-300">Objectives stolen + assists: <span class="font-bold text-white">${Number(stolen).toLocaleString()}</span></p>
        </div>
      `)
    }
    const fbPct = v(fb, "firstBloodInvolvementPercent")
    if (fbPct != null && Number(fbPct) > 0) {
      const fbGames = v(fb, "gamesFirstBloodInvolvement")
      sections.push(`
        <div class="text-left">
          <p class="text-xs font-semibold uppercase tracking-wide text-white/90">First Blood Magnet</p>
          <p class="mt-1 text-stone-300">First Blood involvement: <span class="font-bold text-white">${Number(fbPct).toFixed(0)}%</span> of games${fbGames != null ? ` (${Number(fbGames)} games)` : ""}</p>
        </div>
      `)
    }
    const surrPct = v(surr, "surrenderGamesPercent")
    if (surrPct != null && Number(surrPct) > 0) {
      const surrGames = v(surr, "gamesEndedInSurrender")
      const winrate = v(surr, "winrateInSurrenderGames")
      sections.push(`
        <div class="text-left">
          <p class="text-xs font-semibold uppercase tracking-wide text-white/90">Surrender Stats</p>
          <p class="mt-1 text-stone-300">${Number(surrPct).toFixed(0)}% of games ended in surrender${surrGames != null ? ` (${Number(surrGames)} games)` : ""}</p>
          ${winrate != null ? `<p class="text-stone-400 text-sm">Win rate in surrender games: ${Number(winrate).toFixed(0)}%</p>` : ""}
        </div>
      `)
    }
    if (sections.length === 0) return ""
    return `
      <p class="text-xs font-medium uppercase tracking-widest text-stone-500">Clutch & Chaos Moments</p>
      <p class="mt-2 text-lg font-bold text-white">Storytelling on the Rift</p>
      <div class="mt-6 flex flex-col gap-4">${sections.join("")}</div>
    `
  }

  hasEconomyScalingData(es) {
    if (!es || typeof es !== "object") return false
    const v = (o, k) => (o && o[k]) ?? null
    const avgDur = v(es, "avgGameDurationSeconds")
    const winrate = es.winrateByBucket || es["winrateByBucket"]
    const comeback = es.comebackMerchant || es["comebackMerchant"]
    const scaling = es.scalingPickAddict || es["scalingPickAddict"]
    return (avgDur != null && Number(avgDur) > 0) || (winrate && Object.keys(winrate).length > 0) ||
      (comeback && ((v(comeback, "winsWithNegativeGpmVsOpponent") ?? 0) > 0 || (v(comeback, "winsAfterEarlyGoldDeficit") ?? 0) > 0)) ||
      (scaling && (v(scaling, "scalingChampsPercent") ?? 0) > 0)
  }

  cardEconomyScaling(es) {
    const v = (o, k) => (o && o[k]) ?? null
    const avgSec = v(es, "avgGameDurationSeconds")
    const winrate = es.winrateByBucket || es["winrateByBucket"] || {}
    const gamesByBucket = es.gamesByBucket || es["gamesByBucket"] || {}
    const comeback = es.comebackMerchant || es["comebackMerchant"] || {}
    const scaling = es.scalingPickAddict || es["scalingPickAddict"] || {}
    const sections = []
    if (avgSec != null && Number(avgSec) > 0) {
      const mins = Math.floor(Number(avgSec) / 60)
      const secs = Number(avgSec) % 60
      sections.push(`
        <div class="text-left">
          <p class="text-xs font-semibold uppercase tracking-wide text-white/90">Average Game Length</p>
          <p class="mt-1 text-stone-300"><span class="font-bold text-white">${mins}:${String(secs).padStart(2, "0")}</span> (min:sec)</p>
        </div>
      `)
    }
    const bucketLabels = { under20: "<20 min", w20_30: "20–30 min", over30: "30+ min" }
    const bucketRows = Object.entries(bucketLabels)
      .filter(([k]) => (gamesByBucket[k] ?? 0) > 0)
      .map(([k]) => {
        const g = gamesByBucket[k] ?? 0
        const wr = winrate[k] ?? 0
        return `<span class="text-stone-300">${bucketLabels[k]}: <span class="font-bold text-white">${Number(wr).toFixed(0)}%</span> WR (${g} games)</span>`
      })
      .join(" • ")
    if (bucketRows) {
      sections.push(`
        <div class="text-left">
          <p class="text-xs font-semibold uppercase tracking-wide text-white/90">Winrate by Game Length</p>
          <p class="mt-1">${bucketRows}</p>
        </div>
      `)
    }
    const gpmWins = v(comeback, "winsWithNegativeGpmVsOpponent")
    const goldDefWins = v(comeback, "winsAfterEarlyGoldDeficit")
    if ((gpmWins ?? 0) > 0 || (goldDefWins ?? 0) > 0) {
      sections.push(`
        <div class="text-left">
          <p class="text-xs font-semibold uppercase tracking-wide text-white/90">Comeback Merchant</p>
          <p class="mt-1 text-stone-300">Wins with lower GPM than opponents: <span class="font-bold text-white">${gpmWins ?? 0}</span></p>
          <p class="text-stone-400 text-sm">Wins after gold deficit at 15 min: ${goldDefWins ?? 0}</p>
        </div>
      `)
    }
    const scalingPct = v(scaling, "scalingChampsPercent")
    if (scalingPct != null && Number(scalingPct) > 0) {
      const scalingGames = v(scaling, "gamesOnScalingChamps")
      sections.push(`
        <div class="text-left">
          <p class="text-xs font-semibold uppercase tracking-wide text-white/90">Scaling Pick Addict</p>
          <p class="mt-1 text-stone-300"><span class="font-bold text-white">${Number(scalingPct).toFixed(0)}%</span> of games on late-scaling champs${scalingGames != null ? ` (${Number(scalingGames)} games)` : ""}</p>
        </div>
      `)
    }
    if (sections.length === 0) return ""
    return `
      <p class="text-xs font-medium uppercase tracking-widest text-stone-500">Economy & Scaling</p>
      <p class="mt-2 text-lg font-bold text-white">Long-term Patterns</p>
      <div class="mt-6 flex flex-col gap-4">${sections.join("")}</div>
    `
  }

  hasChampionPersonalityData(cp) {
    if (!cp || typeof cp !== "object") return false
    const v = (o, k) => (o && o[k]) ?? null
    const mostPlayed = cp.mostPlayedChampion || cp["mostPlayedChampion"]
    const oneTrick = v(cp, "oneTrickScore")
    return (mostPlayed && (mostPlayed.games ?? mostPlayed["games"]) > 0) || (oneTrick != null && Number(oneTrick) > 0)
  }

  championIconUrl(champ, ddragonBase, cdragonBase) {
    if (!champ) return ""
    const key = champ.key ?? champ["key"]
    const champId = champ.championId ?? champ["championId"]
    if (key && /^[a-zA-Z0-9_]+$/.test(String(key))) {
      return `${ddragonBase}/${key}.png`
    }
    const numId = champId != null ? Number(champId) : 0
    if (!Number.isNaN(numId) && numId > 0) {
      return `${cdragonBase}/${numId}.png`
    }
    return ""
  }

  cardChampionPersonality(cp, CHAMP_IMG_DDRAGON, CHAMP_IMG_CDRAGON, champNames = {}) {
    const v = (o, k) => (o && o[k]) ?? null
    const champName = (c) => {
      const id = c?.championId ?? c?.["championId"]
      return c?.name ?? c?.["name"] ?? champNames[String(id)] ?? (id != null ? `Champ ${id}` : "")
    }
    const champImg = (c) => {
      if (!c) return ""
      const url = this.championIconUrl(c, CHAMP_IMG_DDRAGON, CHAMP_IMG_CDRAGON)
      if (!url) return ""
      return `<img src="${escapeHtml(url)}" alt="" class="h-12 w-12 rounded-full shrink-0" onerror="this.style.display='none'">`
    }
    const sections = []
    const mostPlayed = cp.mostPlayedChampion || cp["mostPlayedChampion"]
    if (mostPlayed && (mostPlayed.games ?? mostPlayed["games"]) > 0) {
      const name = escapeHtml(champName(mostPlayed))
      const games = mostPlayed.games ?? mostPlayed["games"]
      const winrate = mostPlayed.winrate ?? mostPlayed["winrate"]
      sections.push(`
        <div class="text-left flex items-center gap-3">
          ${champImg(mostPlayed)}
          <div>
            <p class="text-xs font-semibold uppercase tracking-wide text-white/90">Most Played Champion</p>
            <p class="mt-1 text-stone-300"><span class="font-bold text-white">${name}</span> – ${games} games${winrate != null ? `, ${Number(winrate).toFixed(0)}% WR` : ""}</p>
          </div>
        </div>
      `)
    }
    const highestWr = cp.highestWinrateChampion || cp["highestWinrateChampion"]
    if (highestWr && highestWr !== mostPlayed) {
      const name = escapeHtml(champName(highestWr))
      const wr = highestWr.winrate ?? highestWr["winrate"]
      const games = highestWr.games ?? highestWr["games"]
      sections.push(`
        <div class="text-left flex items-center gap-3">
          ${champImg(highestWr)}
          <div>
            <p class="text-xs font-semibold uppercase tracking-wide text-white/90">Highest Winrate Champion</p>
            <p class="mt-1 text-stone-300"><span class="font-bold text-white">${name}</span> – ${Number(wr).toFixed(0)}% WR (${games} games)</p>
          </div>
        </div>
      `)
    }
    const whyPick = cp.whyDoYouKeepPickingThis || cp["whyDoYouKeepPickingThis"]
    if (whyPick) {
      const name = escapeHtml(champName(whyPick))
      const wr = whyPick.winrate ?? whyPick["winrate"]
      const games = whyPick.games ?? whyPick["games"]
      sections.push(`
        <div class="text-left flex items-center gap-3">
          ${champImg(whyPick)}
          <div>
            <p class="text-xs font-semibold uppercase tracking-wide text-red-400/90">Why Do You Keep Picking This?</p>
            <p class="mt-1 text-stone-300"><span class="font-bold text-red-400">${name}</span> – ${games} games at ${Number(wr).toFixed(0)}% WR</p>
          </div>
        </div>
      `)
    }
    const oneTrick = v(cp, "oneTrickScore")
    if (oneTrick != null && Number(oneTrick) > 0) {
      sections.push(`
        <div class="text-left">
          <p class="text-xs font-semibold uppercase tracking-wide text-white/90">One Trick Score</p>
          <p class="mt-1 text-stone-300"><span class="font-bold text-white">${Number(oneTrick).toFixed(0)}%</span> of games on your most played champion</p>
        </div>
      `)
    }
    if (sections.length === 0) return ""
    return `
      <p class="text-3xl font-bold uppercase tracking-widest text-white">Champion Personality</p>
      <div class="mt-6 flex flex-col gap-4">${sections.join("")}</div>
    `
  }

  hasVisionMapIqData(vm) {
    if (!vm || typeof vm !== "object") return false
    const v = (o, k) => (o && o[k]) ?? null
    return (v(vm, "visionScorePerMinAvg") != null && Number(v(vm, "visionScorePerMinAvg")) > 0) ||
      (v(vm, "controlWardsPlacedPerGame") != null && Number(v(vm, "controlWardsPlacedPerGame")) >= 0) ||
      (v(vm, "wardTakedownsPerGame") != null && Number(v(vm, "wardTakedownsPerGame")) > 0) ||
      (vm.mapAwarenessScore && ((v(vm.mapAwarenessScore, "enemyMissingPingsUsed") ?? 0) > 0 || (v(vm.mapAwarenessScore, "visionScoreAdvantageLaneOpponentAvg") != null)))
  }

  cardVisionMapIq(vm) {
    const v = (o, k) => (o && o[k]) ?? null
    const mapAwareness = vm.mapAwarenessScore || vm["mapAwarenessScore"] || {}
    const sections = []
    const vsPerMin = v(vm, "visionScorePerMinAvg")
    if (vsPerMin != null && Number(vsPerMin) >= 0) {
      sections.push(`
        <div class="text-left">
          <p class="text-xs font-semibold uppercase tracking-wide text-white/90">Vision Score Per Minute</p>
          <p class="mt-1 text-stone-300">Average: <span class="font-bold text-white">${Number(vsPerMin).toFixed(2)}</span></p>
        </div>
      `)
    }
    const ctrlWards = v(vm, "controlWardsPlacedPerGame")
    if (ctrlWards != null) {
      sections.push(`
        <div class="text-left">
          <p class="text-xs font-semibold uppercase tracking-wide text-white/90">Control Wards</p>
          <p class="mt-1 text-stone-300"><span class="font-bold text-white">${Number(ctrlWards).toFixed(1)}</span> per game</p>
        </div>
      `)
    }
    const wardTakedowns = v(vm, "wardTakedownsPerGame")
    if (wardTakedowns != null && Number(wardTakedowns) > 0) {
      sections.push(`
        <div class="text-left">
          <p class="text-xs font-semibold uppercase tracking-wide text-white/90">Ward Takedowns</p>
          <p class="mt-1 text-stone-300"><span class="font-bold text-white">${Number(wardTakedowns).toFixed(1)}</span> per game</p>
        </div>
      `)
    }
    const enemyMissing = v(mapAwareness, "enemyMissingPingsUsed")
    const vsAdvantage = v(mapAwareness, "visionScoreAdvantageLaneOpponentAvg")
    if ((enemyMissing != null && Number(enemyMissing) >= 0) || vsAdvantage != null) {
      const parts = []
      if (enemyMissing != null) parts.push(`Enemy Missing pings: <span class="font-bold text-white">${Number(enemyMissing).toLocaleString()}</span>`)
      if (vsAdvantage != null) parts.push(`Vision advantage vs lane: <span class="font-bold text-white">${Number(vsAdvantage).toFixed(1)}</span> avg`)
      if (parts.length > 0) {
        sections.push(`
          <div class="text-left">
            <p class="text-xs font-semibold uppercase tracking-wide text-white/90">Map Awareness Score</p>
            <p class="mt-1 text-stone-300">${parts.join(" • ")}</p>
          </div>
        `)
      }
    }
    if (sections.length === 0) return ""
    return `
      <p class="text-xs font-medium uppercase tracking-widest text-stone-500">Vision & Map IQ</p>
      <p class="mt-2 text-lg font-bold text-white">Often overlooked but cool</p>
      <div class="mt-6 flex flex-col gap-4">${sections.join("")}</div>
    `
  }

  hasDamageProfileData(dp) {
    if (!dp || typeof dp !== "object") return false
    const split = dp.damageSplitPersonality || dp["damageSplitPersonality"]
    const tank = dp.tankVsGlassCannon || dp["tankVsGlassCannon"]
    const dps = dp.dpsMonster || dp["dpsMonster"]
    const v = (o, k) => (o && o[k]) ?? null
    return (split && (v(split, "physicalPercent") != null || v(split, "magicPercent") != null)) ||
      (tank && (v(tank, "damageTakenOnTeamPercentageAvg") != null || (v(tank, "damageSelfMitigatedTotal") ?? 0) > 0)) ||
      (dps && (v(dps, "damagePerMinutePeak") != null || v(dps, "damagePerMinuteAvg") != null))
  }

  cardDamageProfile(dp) {
    const v = (o, k) => (o && o[k]) ?? null
    const split = dp.damageSplitPersonality || dp["damageSplitPersonality"] || {}
    const tank = dp.tankVsGlassCannon || dp["tankVsGlassCannon"] || {}
    const dps = dp.dpsMonster || dp["dpsMonster"] || {}
    const sections = []
    const phys = v(split, "physicalPercent")
    const magic = v(split, "magicPercent")
    const truePct = v(split, "truePercent")
    if ((phys != null || magic != null) && (Number(phys ?? 0) + Number(magic ?? 0) + Number(truePct ?? 0)) > 0) {
      const clamp = (n) => Math.min(100, Math.max(0, Number(n) || 0))
      const physW = clamp(phys ?? 0)
      const magicW = clamp(magic ?? 0)
      const trueW = clamp(truePct ?? 0)
      const parts = []
      if (physW > 0) parts.push({ flex: physW, color: "bg-red-500" })
      if (magicW > 0) parts.push({ flex: magicW, color: "bg-blue-500" })
      if (trueW > 0) parts.push({ flex: trueW, color: "bg-white" })
      const segmentHtml = parts.map((p, i) => {
        const first = i === 0
        const last = i === parts.length - 1
        const rounding = first && last ? " rounded" : first ? " rounded-l" : last ? " rounded-r" : ""
        return `<div class="min-w-0 shrink-0 ${escapeHtml(p.color)}${escapeHtml(rounding)}" style="flex:${p.flex} 0 0"></div>`
      }).join("")
      sections.push(`
        <div class="text-left">
          <p class="text-xs font-semibold uppercase tracking-wide text-white/90">Damage Split Personality</p>
          <div class="mt-2 flex h-4 w-full overflow-hidden rounded bg-stone-700">
            ${segmentHtml}
          </div>
          <p class="mt-1 text-stone-400 text-sm">Physical ${Number(phys ?? 0).toFixed(0)}% • Magic ${Number(magic ?? 0).toFixed(0)}% • True ${Number(truePct ?? 0).toFixed(0)}%</p>
        </div>
      `)
    }
    const dmgTakenPct = v(tank, "damageTakenOnTeamPercentageAvg")
    const selfMitigated = v(tank, "damageSelfMitigatedTotal")
    if (dmgTakenPct != null || (selfMitigated != null && Number(selfMitigated) > 0)) {
      const tankParts = []
      if (dmgTakenPct != null) tankParts.push(`Damage taken on team: <span class="font-bold text-white">${Number(dmgTakenPct).toFixed(1)}%</span> avg`)
      if (selfMitigated != null && Number(selfMitigated) > 0) tankParts.push(`Self-mitigated: <span class="font-bold text-white">${Number(selfMitigated).toLocaleString()}</span>`)
      sections.push(`
        <div class="text-left">
          <p class="text-xs font-semibold uppercase tracking-wide text-white/90">Tank vs Glass Cannon</p>
          <p class="mt-1 text-stone-300">${tankParts.join(" • ")}</p>
        </div>
      `)
    }
    const dpmPeak = v(dps, "damagePerMinutePeak")
    const dpmAvg = v(dps, "damagePerMinuteAvg")
    if (dpmPeak != null || dpmAvg != null) {
      sections.push(`
        <div class="text-left">
          <p class="text-xs font-semibold uppercase tracking-wide text-white/90">DPS Monster</p>
          <p class="mt-1 text-stone-300">Peak DPM: <span class="font-bold text-white">${dpmPeak != null ? Number(dpmPeak).toLocaleString() : "—"}</span> • Avg DPM: <span class="font-bold text-white">${dpmAvg != null ? Number(dpmAvg).toLocaleString() : "—"}</span></p>
        </div>
      `)
    }
    if (sections.length === 0) return ""
    return `
      <p class="text-xs font-medium uppercase tracking-widest text-stone-500">Damage Profile</p>
      <p class="mt-2 text-lg font-bold text-white">Visually strong in recap slides</p>
      <div class="mt-6 flex flex-col gap-4">${sections.join("")}</div>
    `
  }

  hasBotLaneSynergyData(bls) {
    if (!bls || typeof bls !== "object") return false
    const duos = bls.topDuos || bls["topDuos"] || []
    const rideOrDie = bls.rideOrDie || bls["rideOrDie"]
    return (Array.isArray(duos) && duos.length > 0) || (rideOrDie && (rideOrDie.games ?? rideOrDie["games"]) > 0)
  }

  cardBotLaneSynergy(bls) {
    const v = (o, k) => (o && o[k]) ?? null
    const duos = bls.topDuos || bls["topDuos"] || []
    const rideOrDie = bls.rideOrDie || bls["rideOrDie"]
    const sections = []
    if (rideOrDie && (v(rideOrDie, "games") ?? 0) > 0) {
      const name = escapeHtml(v(rideOrDie, "teammateName") || v(rideOrDie, "teammateRiotId") || "Your Duo")
      const games = v(rideOrDie, "games")
      const winrate = v(rideOrDie, "winrate")
      const kp = v(rideOrDie, "killParticipation")
      const pct = v(rideOrDie, "pctOfTotalGames")
      sections.push(`
        <div class="text-left">
          <p class="text-xs font-semibold uppercase tracking-wide text-white/90">Ride or Die</p>
          <p class="mt-1 text-2xl font-bold text-white">${name}</p>
          <p class="mt-2 text-stone-300">${games} games together • ${winrate != null ? `${Number(winrate).toFixed(0)}%` : "—"} winrate${kp != null ? ` • ${Number(kp).toFixed(0)}%` : ""} KP when together${pct != null ? `<br><span class="text-stone-400 text-sm">${Number(pct).toFixed(0)}% of your games were with them</span>` : ""}</p>
        </div>
      `)
    }
    const otherDuos = duos.slice(1).filter((d) => (v(d, "games") ?? 0) > 0)
    if (otherDuos.length > 0) {
      sections.push(`
        <div class="text-left">
          <p class="text-xs font-semibold uppercase tracking-wide text-white/90">Top Duos</p>
          <div class="mt-2 space-y-1">
            ${otherDuos.slice(0, 4).map((d) => {
              const name = escapeHtml(v(d, "teammateName") || v(d, "teammateRiotId") || "Unknown")
              const g = v(d, "games")
              const wr = v(d, "winrate")
              const kp = v(d, "killParticipation")
              const pct = v(d, "pctOfTotalGames")
              return `<p class="text-stone-300">${name}: ${g} games, ${wr != null ? `${Number(wr).toFixed(0)}%` : "—"} WR${kp != null ? `, ${Number(kp).toFixed(0)}% KP` : ""}${pct != null ? ` (${Number(pct).toFixed(0)}% of yours)` : ""}</p>`
            }).join("")}
          </div>
        </div>
      `)
    }
    if (sections.length === 0) return ""
    return `
      <p class="text-xs font-medium uppercase tracking-widest text-stone-500">Bot Lane Synergy</p>
      <p class="mt-2 text-lg font-bold text-white">Your ride or die</p>
      <div class="mt-6 flex flex-col gap-4">${sections.join("")}</div>
    `
  }

  cardMemeTitles(titles) {
    if (!Array.isArray(titles) || titles.length === 0) return ""
    return `
      <p class="text-xs font-medium uppercase tracking-widest text-stone-500">Your Meme Titles</p>
      <p class="mt-2 text-lg font-bold text-white">Fun, meme-able titles</p>
      <div class="mt-6 flex flex-wrap justify-center gap-2">
        ${titles.map((t) => `<span class="rounded-full bg-stone-500/30 px-4 py-2 text-sm font-semibold text-white">${escapeHtml(t)}</span>`).join("")}
      </div>
    `
  }

  cardTeammates(list) {
    const top10 = list.slice(0, 10)
    return `
      <p class="text-xs font-medium uppercase tracking-widest text-stone-500">Most played with</p>
      <div class="mt-6 space-y-2">
        ${top10.map((r, i) => {
          const name = escapeHtml(r.teammate_name || r.teammate_riot_id || "Unknown")
          return `<div class="text-lg"><span class="font-bold text-white">#${i + 1}</span> ${name} <span class="text-stone-500">– ${safeDisplay(r.games)} games</span></div>`
        }).join("")}
      </div>
    `
  }

  cardNemesis(enemies) {
    const top10 = enemies.slice(0, 10)
    return `
      <p class="text-xs font-medium uppercase tracking-widest text-stone-500">Your nemeses</p>
      <div class="mt-6 space-y-2">
        ${top10.map((r, i) => {
          const name = escapeHtml(r.enemy_name || r.enemy_riot_id || "Unknown")
          return `<div class="text-lg"><span class="font-bold text-red-400">#${i + 1}</span> ${name} <span class="text-stone-500">– beat you ${safeDisplay(r.times_beat_us)}×</span></div>`
        }).join("")}
      </div>
    `
  }

  cardItems(favItems, ITEM_IMG_BASE) {
    const items = favItems.filter((item) => item && ((item.item_id ?? item.itemId) != null)).slice(0, 5)
    return `
      <p class="text-xs font-medium uppercase tracking-widest text-stone-500">Top 5 items built</p>
      <div class="mt-6 flex flex-wrap justify-center gap-4">
        ${items.map((item) => {
          const id = safeUrlSegment(item.item_id ?? item.itemId)
          const name = escapeHtml(item.name || `Item ${item.item_id ?? item.itemId}`)
          const count = item.count ?? 0
          return `<div class="flex flex-col items-center"><img src="${ITEM_IMG_BASE}/${id}.png" alt="${name}" class="h-14 w-14 rounded" onerror="this.style.display='none'"><span class="mt-2 text-sm text-stone-300">${name}</span><span class="text-white font-semibold">${safeDisplay(count)} games</span></div>`
        }).join("")}
      </div>
    `
  }

  cardBans(ourTeamBans, enemyTeamBans, CHAMP_IMG_DDRAGON, CHAMP_IMG_CDRAGON) {
    const topOur = ourTeamBans.slice(0, 5)
    const topEnemy = enemyTeamBans.slice(0, 5)
    const banImg = (b) => {
      const url = this.championIconUrl({ key: b.key, championId: b.champion_id }, CHAMP_IMG_DDRAGON, CHAMP_IMG_CDRAGON)
      return url ? `<img src="${escapeHtml(url)}" alt="" class="h-8 w-8 shrink-0 rounded-full" onerror="this.style.display='none'">` : ""
    }
    return `
      <p class="text-xs font-medium uppercase tracking-widest text-stone-500">Top 5 bans</p>
      <div class="mt-6 grid grid-cols-2 gap-6">
        <div>
          <p class="mb-2 text-xs text-stone-500">Your team</p>
          <div class="space-y-2">
            ${topOur.map((b) => {
              const name = escapeHtml(b.name || `Champ ${b.champion_id}`)
              const count = safeDisplay(b.count)
              return `<div class="flex items-center justify-between gap-2"><div class="flex items-center gap-2 min-w-0">${banImg(b)}<span class="text-stone-300 truncate">${name}</span></div><span class="text-white font-semibold shrink-0">${count}×</span></div>`
            }).join("")}
          </div>
        </div>
        <div>
          <p class="mb-2 text-xs text-stone-500">Enemy team</p>
          <div class="space-y-2">
            ${topEnemy.map((b) => {
              const name = escapeHtml(b.name || `Champ ${b.champion_id}`)
              const count = safeDisplay(b.count)
              return `<div class="flex items-center justify-between gap-2"><div class="flex items-center gap-2 min-w-0">${banImg(b)}<span class="text-stone-300 truncate">${name}</span></div><span class="text-red-400 font-semibold shrink-0">${count}×</span></div>`
            }).join("")}
          </div>
        </div>
      </div>
    `
  }

  cardPings(totalPings, pingBreakdown) {
    const entries = Object.entries(pingBreakdown)
      .filter(([, count]) => Number(count) > 0)
      .sort((a, b) => Number(b[1]) - Number(a[1]))
    const topType = entries[0]
    const topLabel = topType ? this.pingLabel(topType[0]) : "Pings"
    const topCount = topType ? Number(topType[1]) : 0
    return `
      <p class="text-xs font-medium uppercase tracking-widest text-stone-500">Pings used</p>
      <p class="mt-4 text-5xl font-bold text-white">${Number(totalPings).toLocaleString()}</p>
      <p class="mt-2 text-stone-500">total • most used: <span class="text-stone-300">${escapeHtml(topLabel)}</span> (${topCount.toLocaleString()})</p>
    `
  }

  cardExtra(extraEntries) {
    const top2 = extraEntries.slice(0, 2)
    return `
      <p class="text-xs font-medium uppercase tracking-widest text-stone-500">Combat highlights</p>
      <div class="mt-6 space-y-4">
        ${top2.map(([key, val]) => {
          const label = escapeHtml(this.extraStatLabel(key))
          const value = escapeHtml(this.formatExtraStatValue(key, val))
          return `<div><span class="text-stone-400">${label}</span><br><span class="text-2xl font-bold text-white">${value}</span></div>`
        }).join("")}
      </div>
    `
  }

  closeWrapped() {
    if (this.backUrlValue) {
      window.location = this.backUrlValue
      return
    }
    if (!this.hasWrappedModalTarget) return
    this.wrappedModalTarget.classList.add("hidden")
    this.wrappedModalTarget.setAttribute("aria-hidden", "true")
    if (this.boundEscape) {
      document.removeEventListener("keydown", this.boundEscape)
      this.boundEscape = null
    }
  }

  showMessage(text, type) {
    if (!this.hasMessageTarget) return
    this.messageTarget.textContent = text
    this.messageTarget.className = "text-sm " + (type === "success" ? "text-white" : type === "error" ? "text-red-400" : "text-stone-400")
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
