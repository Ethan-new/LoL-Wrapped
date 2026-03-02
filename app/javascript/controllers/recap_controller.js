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

// Community Dragon splash filenames for champions with non-standard naming (e.g. VGU variants).
const SPLASH_FILENAME_OVERRIDES = {
  viktor: "viktor_splash_centered_0.viktorvgu.jpg"
}

// Champions that use skins/skin0 instead of skins/base in Community Dragon.
const SPLASH_SKIN0_CHAMPIONS = ["hwei"]

// Human-readable labels for Riot API ping types.
const PING_LABELS = {
  allInPings: "All-in",
  assistMePings: "Assist me",
  baitPings: "Bait",
  basicPings: "Basic",
  commandPings: "Command",
  dangerPings: "Danger",
  enemyMissingPings: "Enemy missing",
  enemyVisionPings: "Enemy vision",
  getBackPings: "Get back",
  retreatPings: "Retreat",
  holdPings: "Hold",
  needVisionPings: "Need vision",
  onMyWayPings: "On my way",
  pushPings: "Push",
  visionClearedPings: "Vision cleared"
}

// Local ping icon paths (public/pings/)
const PING_ICON_URLS = {
  allInPings: "/pings/All_In_ping.webp",
  assistMePings: "/pings/Assist_Me_ping.webp",
  baitPings: "/pings/Bait_ping.webp",
  basicPings: "/pings/Generic_ping.webp",
  commandPings: "/pings/Target_ping.webp",
  dangerPings: "/pings/Caution_ping.webp",
  enemyMissingPings: "/pings/Enemy_Missing_ping.webp",
  enemyVisionPings: "/pings/Enemy_Vision_ping.webp",
  getBackPings: "/pings/Retreat_ping.webp",
  retreatPings: "/pings/Retreat_ping.webp",
  holdPings: "/pings/Hold_ping.webp",
  needVisionPings: "/pings/Need_Vision_ping.webp",
  onMyWayPings: "/pings/On_My_Way_ping.webp",
  pushPings: "/pings/Push_ping.webp",
  visionClearedPings: "/pings/Generic_ping.webp"
}

function pingKeyToLabel(key) {
  const k = String(key || "").replace(/[Pp]ings?$/, "")
  if (!k) return key
  const label = PING_LABELS[key]
  if (label) return label
  return k.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase()).trim()
}

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
    recapPageUrl: String,
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

  static targets = ["recapAction", "recapActionLabel", "recapActionIconGenerate", "recapActionIconWatch", "generateButton", "viewButton", "computeButton", "message", "loadingBlock", "progressBlock", "progressSpinner", "progressContent", "wrappedModal", "cardsContainer", "shareBlock"]

  async connect() {
    this.updateStatusDisplay()
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
    if (this.hasLoadingBlockTarget) this.loadingBlockTarget.classList.remove("hidden")
    if (this.hasMessageTarget) this.showMessage("", "")
    try {
      const response = await fetch(url, { headers: { "Accept": "application/json" } })
      const contentType = response.headers.get("content-type") || ""
      let data = {}
      if (contentType.includes("application/json")) {
        data = await response.json().catch(() => ({}))
      } else if (!response.ok) {
        if (this.hasLoadingBlockTarget) this.loadingBlockTarget.classList.add("hidden")
        this.showMessage(`Recap failed (${response.status}). Try again later.`, "error")
        return
      }
      const hasExtraStats = data.extra_stats && (
        (data.extra_stats.gamesCount ?? 0) > 0 ||
        (data.extra_stats.queueDistribution && Object.keys(data.extra_stats.queueDistribution || {}).length > 0) ||
        (data.extra_stats.championPersonality?.mostPlayedChampion ?? data.extra_stats.championPersonality?.["mostPlayedChampion"]) ||
        (data.extra_stats.topChampions?.length ?? 0) > 0 ||
        data.extra_stats.mvpInsight ||
        data.extra_stats.bestGame ||
        data.extra_stats.worstGame
      )
      const hasBans = (data.our_team_bans?.length ?? 0) > 0 || (data.enemy_team_bans?.length ?? 0) > 0
      const hasKda = (data.total_kills ?? 0) > 0 || (data.total_deaths ?? 0) > 0 || (data.total_assists ?? 0) > 0
      if (response.ok && (data.most_played_with?.length || data.most_beat_us?.length || (data.total_pings ?? 0) > 0 || (data.total_game_seconds ?? 0) > 0 || (data.total_gold_spent ?? 0) > 0 || (data.fav_items?.length ?? 0) > 0 || hasExtraStats || hasBans || hasKda)) {
        const [champNames, itemNames] = await Promise.all([this.fetchChampionNames(), this.fetchItemNames()])
        this.renderWrappedCards(data, year, champNames, itemNames)
        if (this.hasWrappedModalTarget) {
          this.wrappedModalTarget.classList.remove("hidden")
          this.wrappedModalTarget.setAttribute("aria-hidden", "false")
        }
        if (this.hasLoadingBlockTarget) this.loadingBlockTarget.classList.add("hidden")
        if (this.hasMessageTarget) this.showMessage("", "")
      } else {
        if (this.hasLoadingBlockTarget) this.loadingBlockTarget.classList.add("hidden")
        this.showMessage(data.error || "No recap data for this year. Generate a recap from your profile first.", "error")
      }
    } catch (err) {
      if (this.hasLoadingBlockTarget) this.loadingBlockTarget.classList.add("hidden")
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
        (data.extra_stats && (
          (data.extra_stats.gamesCount ?? 0) > 0 ||
          (data.extra_stats.queueDistribution && Object.keys(data.extra_stats.queueDistribution || {}).length > 0) ||
          (data.extra_stats.championPersonality?.mostPlayedChampion ?? data.extra_stats.championPersonality?.["mostPlayedChampion"]) ||
          (data.extra_stats.topChampions?.length ?? 0) > 0 ||
          data.extra_stats.mvpInsight ||
          data.extra_stats.bestGame ||
          data.extra_stats.worstGame
        )) ||
        (data.our_team_bans?.length ?? 0) > 0 || (data.enemy_team_bans?.length ?? 0) > 0 ||
        (data.total_kills ?? 0) > 0 || (data.total_deaths ?? 0) > 0 || (data.total_assists ?? 0) > 0
      if (hasData) {
        this.stopPolling()
        if (this.element?.isConnected) {
          this.recapStatusesValue = { ...(this.recapStatusesValue || {}), [year]: "ready" }
          this.updateStatusDisplay()
          this.showMessage("Recap is ready! Click \"Watch my recap\" to see it.", "success")
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
    if (this.hasRecapActionTarget) {
      this.updateRecapAction(isGenerating, hasRecap)
    } else {
      this.updateButtonState("generate", isGenerating, "Generating…", hasRecap ? "Regenerate recap" : "Generate recap")
      this.updateButtonState("view", isGenerating, "Please wait…", "View recap")
      this.updateButtonState("compute", isGenerating, "Computing…", "Compute")
    }

    if (this.hasShareBlockTarget) {
      this.shareBlockTarget.classList.toggle("hidden", !hasRecap)
    }
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
    const downloaded = progress.downloaded ?? progress["downloaded"]

    const target = downloaded != null && downloaded >= 0 && queuePosition === 0 ? parseInt(downloaded, 10) : null
    const showingDownloaded = this._progressBlockType === "downloaded" && this.progressContentTarget.querySelector(".recap-progress-count")

    if (target != null && showingDownloaded) {
      this.animateProgressCount(target)
      return
    }

    let html = ""
    if (phase === "computing") {
      this._progressBlockType = "computing"
      html = `<p class="text-white">Computing your recap…</p>`
    } else if (phase === "downloading") {
      if (queuePosition != null) {
        if (queuePosition > 0) {
          this._progressBlockType = "position"
          html = `<p class="text-white">${queuePosition === 1 ? "You're next!" : `Position in queue: ${queuePosition}`}</p>`
        } else if (downloaded != null && downloaded >= 0) {
          this._progressBlockType = "downloaded"
          html = `<p class="text-white">Downloaded <span class="recap-progress-count tabular-nums font-semibold text-emerald-400">${this.lastProgressCount ?? 0}</span> matches</p>`
          this.progressContentTarget.innerHTML = html
          this.animateProgressCount(target)
          this.progressBlockTarget.classList.remove("hidden")
          if (this.hasProgressSpinnerTarget) {
            this.progressSpinnerTarget.classList.toggle("hidden", false)
          }
          return
        } else {
          this._progressBlockType = "generating"
          html = `<p class="text-white">Your recap is being generated…</p>`
        }
      } else {
        this._progressBlockType = "waiting"
        html = `<p class="text-white">Waiting in queue…</p>`
      }
      if (!html) {
        this._progressBlockType = "contacting"
        html = `<p class="text-white">Contacting Riot to get all your games from ${recapYear()}…</p>`
      }
    } else {
      this._progressBlockType = "contacting"
      html = `<p class="text-white">Contacting Riot to get all your games from ${recapYear()}…</p>`
    }

    this.progressContentTarget.innerHTML = html
    this.progressBlockTarget.classList.remove("hidden")
    if (this.hasProgressSpinnerTarget) {
      const showSpinner = phase === "downloading" || phase === "computing"
      this.progressSpinnerTarget.classList.toggle("hidden", !showSpinner)
    }
  }

  animateProgressCount(target) {
    const span = this.progressContentTarget?.querySelector(".recap-progress-count")
    if (!span) return
    if (this._progressCountRaf) cancelAnimationFrame(this._progressCountRaf)
    const start = this.lastProgressCount ?? parseInt(span.textContent || "0", 10)
    this.lastProgressCount = target
    if (start === target) {
      span.textContent = target.toLocaleString()
      return
    }
    const diff = Math.abs(target - start)
    const duration = Math.min(2000, 800 + diff * 25)
    const startTime = performance.now()
    const update = (currentTime) => {
      const elapsed = currentTime - startTime
      const progress = Math.min(elapsed / duration, 1)
      const eased = progress < 0.5
        ? 4 * progress * progress * progress
        : 1 - Math.pow(-2 * progress + 2, 3) / 2
      const current = Math.round(start + (target - start) * eased)
      span.textContent = current.toLocaleString()
      if (progress < 1) {
        this._progressCountRaf = requestAnimationFrame(update)
      } else {
        span.textContent = target.toLocaleString()
        this._progressCountRaf = null
      }
    }
    this._progressCountRaf = requestAnimationFrame(update)
  }

  hideProgressBlock() {
    if (this._progressCountRaf) {
      cancelAnimationFrame(this._progressCountRaf)
      this._progressCountRaf = null
    }
    this.lastProgressCount = undefined
    this._progressBlockType = undefined
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

  updateRecapAction(isGenerating, hasRecap) {
    const el = this.recapActionTarget
    const labelEl = this.hasRecapActionLabelTarget ? this.recapActionLabelTarget : el
    if (isGenerating) {
      el.href = "#"
      labelEl.textContent = "Generating…"
      el.classList.add("pointer-events-none", "opacity-75")
      el.setAttribute("aria-disabled", "true")
      this._showRecapActionIcon("generate")
    } else {
      if (hasRecap) {
        el.href = this.recapPageUrlValue || "#"
        labelEl.textContent = "Watch my recap"
        this._showRecapActionIcon("watch")
      } else {
        el.href = "#"
        labelEl.textContent = "Generate my recap"
        this._showRecapActionIcon("generate")
      }
      el.classList.remove("pointer-events-none", "opacity-75")
      el.removeAttribute("aria-disabled")
    }
  }

  _showRecapActionIcon(which) {
    if (this.hasRecapActionIconGenerateTarget) {
      this.recapActionIconGenerateTarget.classList.toggle("hidden", which !== "generate")
    }
    if (this.hasRecapActionIconWatchTarget) {
      this.recapActionIconWatchTarget.classList.toggle("hidden", which !== "watch")
    }
  }

  recapAction(event) {
    const statuses = this.recapStatusesValue || {}
    const year = recapYear()
    const status = statuses[String(year)]
    const isGenerating = status === "generating"
    const hasRecap = status === "ready"

    if (isGenerating) {
      event.preventDefault()
      return
    }
    if (hasRecap) {
      // Allow default navigation to recap page
      return
    }
    event.preventDefault()
    this.generate(event)
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
    if (this.hasRecapActionTarget) {
      const labelEl = this.hasRecapActionLabelTarget ? this.recapActionLabelTarget : this.recapActionTarget
      labelEl.textContent = "Generating…"
      this.recapActionTarget.href = "#"
      this.recapActionTarget.classList.add("pointer-events-none", "opacity-75")
      this._showRecapActionIcon("generate")
    }
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
      const hasExtraStats = data.extra_stats && (
        (data.extra_stats.gamesCount ?? 0) > 0 ||
        (data.extra_stats.queueDistribution && Object.keys(data.extra_stats.queueDistribution || {}).length > 0) ||
        (data.extra_stats.championPersonality?.mostPlayedChampion ?? data.extra_stats.championPersonality?.["mostPlayedChampion"]) ||
        (data.extra_stats.topChampions?.length ?? 0) > 0 ||
        data.extra_stats.mvpInsight ||
        data.extra_stats.bestGame ||
        data.extra_stats.worstGame
      )
      const hasBans = (data.our_team_bans?.length ?? 0) > 0 || (data.enemy_team_bans?.length ?? 0) > 0
      const hasKda = (data.total_kills ?? 0) > 0 || (data.total_deaths ?? 0) > 0 || (data.total_assists ?? 0) > 0
      if (response.ok && (data.most_played_with?.length || data.most_beat_us?.length || (data.total_pings ?? 0) > 0 || (data.total_game_seconds ?? 0) > 0 || (data.total_gold_spent ?? 0) > 0 || (data.fav_items?.length ?? 0) > 0 || hasExtraStats || hasBans || hasKda)) {
        this.recapStatusesValue = { ...(this.recapStatusesValue || {}), [year]: "ready" }
        this.updateStatusDisplay()
        this.showMessage("", "")
        const [champNames, itemNames] = await Promise.all([this.fetchChampionNames(), this.fetchItemNames()])
        this.renderWrappedCards(data, year, champNames, itemNames)
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
      const names = {}
      const splashKeys = {}
      const data = json.data || {}
      for (const champ of Object.values(data)) {
        if (champ && champ.key) {
          const id = String(champ.key)
          names[id] = champ.name || champ.id
          splashKeys[id] = champ.id || champ.name
        }
      }
      return Object.assign(names, { _splashKeys: splashKeys })
    } catch {
      return { _splashKeys: {} }
    }
  }

  async fetchItemNames() {
    try {
      const res = await fetch("https://ddragon.leagueoflegends.com/cdn/16.4.1/data/en_US/item.json")
      const json = await res.json().catch(() => ({}))
      const names = {}
      const data = json.data || {}
      for (const [id, item] of Object.entries(data)) {
        if (item && item.name) names[String(id)] = item.name
      }
      return names
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

  renderWrappedCards(data, year, champNames = {}, itemNames = {}) {
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
    const profileIconUrl = this.profileIconUrlValue || data.profile_icon_url || ""
    const queueDistribution = extraStats.queueDistribution || extraStats["queueDistribution"]
    const totalGamesFromQueue = queueDistribution && typeof queueDistribution === "object"
      ? Object.values(queueDistribution).reduce((a, b) => a + (Number(b) || 0), 0)
      : 0
    const gamesCount = extraStats.gamesCount ?? extraStats["gamesCount"] ?? totalGamesFromQueue
    const uniqueChampions = Number(extraStats.uniqueChampionsPlayed ?? extraStats["uniqueChampionsPlayed"] ?? 0)
    const hasOverview = gamesCount > 0 || totalGameSeconds > 0 || uniqueChampions > 0

    if (hasOverview) {
      if (playerRiotId || year) {
        cards.push({ type: "intro", html: this.cardIntro(playerRiotId, year, profileIconUrl) })
      }
      cards.push({ type: "overview", html: this.cardOverview(gamesCount, totalGameSeconds, uniqueChampions) })
    } else {
      cards.push({ type: "empty", html: this.cardEmptyNoGames(year, playerRiotId, profileIconUrl) })
    }

    if (hasOverview) {
    const championPersonalityData = extraStats.championPersonality || extraStats["championPersonality"] || extraStats.champion_personality || extraStats["champion_personality"]
    const mostPlayed = championPersonalityData?.mostPlayedChampion || championPersonalityData?.["mostPlayedChampion"] || championPersonalityData?.most_played_champion || championPersonalityData?.["most_played_champion"]
    if (mostPlayed && (mostPlayed.games ?? mostPlayed["games"]) > 0) {
      cards.push({ type: "mostPlayedChampion", html: this.cardMostPlayedChampion(mostPlayed, champNames, CHAMP_IMG_DDRAGON) })
    }
    const topChampions = extraStats.topChampions ?? extraStats["topChampions"] ?? extraStats.top_champions ?? extraStats["top_champions"]
    if (topChampions && Array.isArray(topChampions) && topChampions.length > 0) {
      cards.push({ type: "championPool", html: this.cardChampionPool(topChampions, champNames, CHAMP_IMG_DDRAGON, CHAMP_IMG_CDRAGON) })
    }
    const seasonKdaHtml = this.cardSeasonKda(totalKills, totalDeaths, totalAssists, gamesCount)
    if (seasonKdaHtml) {
      cards.push({ type: "seasonKda", html: seasonKdaHtml })
    }
    const multiKills = extraStats.multiKills ?? extraStats["multiKills"]
    if (multiKills) {
      const multiKillsHtml = this.cardMultiKills(multiKills, champNames, CHAMP_IMG_DDRAGON, CHAMP_IMG_CDRAGON)
      if (multiKillsHtml) cards.push({ type: "multiKills", html: multiKillsHtml })
    }
    const mvpInsight = extraStats.mvpInsight ?? extraStats["mvpInsight"]
    if (mvpInsight) {
      const archetype = typeof mvpInsight === "string" ? mvpInsight : (mvpInsight.archetype ?? mvpInsight["archetype"])
      const stats = (typeof mvpInsight === "object" && mvpInsight != null) ? (mvpInsight.stats ?? mvpInsight["stats"] ?? []) : []
      cards.push({ type: "mvpInsight", html: this.cardMvpInsight(archetype, stats) })
    }
    const bestGame = extraStats.bestGame ?? extraStats["bestGame"]
    const worstGame = extraStats.worstGame ?? extraStats["worstGame"]
    if (bestGame || worstGame) {
      cards.push({ type: "bestAndWorstGame", html: this.cardBestAndWorstGame(bestGame, worstGame, champNames, CHAMP_IMG_DDRAGON, CHAMP_IMG_CDRAGON) })
    }
    if (list.length > 0 || enemies.length > 0) {
      cards.push({ type: "friendsAndFoes", html: this.cardFriendsAndFoes(list, enemies) })
    }
    if (ourTeamBans.length > 0 || enemyTeamBans.length > 0) {
      cards.push({ type: "bans", html: this.cardBans(ourTeamBans, enemyTeamBans, champNames, CHAMP_IMG_DDRAGON, CHAMP_IMG_CDRAGON) })
    }
    const BISCUIT_ITEM_ID = 2010
    const filteredFavItems = (favItems || []).filter((item) => item && Number(item.item_id ?? item.itemId) !== BISCUIT_ITEM_ID)
    if (filteredFavItems.length > 0) {
      cards.push({ type: "items", html: this.cardItems(filteredFavItems, itemNames, ITEM_IMG_BASE) })
    }
    if (totalPings > 0) {
      const pingsHtml = this.cardPings(pingBreakdown, totalPings)
      if (pingsHtml) cards.push({ type: "pings", html: pingsHtml })
    }
    }

    if (cards.length === 0) {
      cards.push({ type: "empty", html: this.cardEmptyNoGames(year, playerRiotId, profileIconUrl) })
    }
    cards.push({ type: "thankYou", html: this.cardThankYou() })

    this.cardsContainerTarget.innerHTML = cards.map((c) => {
      const isWideCard = c.type === "mostPlayedChampion" || c.type === "championPool" || c.type === "bestAndWorstGame" || c.type === "friendsAndFoes"
      const maxWidth = c.type === "championPool" ? "max-w-4xl min-w-0" : c.type === "bestAndWorstGame" ? "max-w-5xl min-w-0" : c.type === "mostPlayedChampion" ? "max-w-2xl" : c.type === "friendsAndFoes" ? "max-w-2xl" : ""
      const innerClass = isWideCard ? `flex w-full ${maxWidth} flex-col items-center` : "flex max-w-lg flex-col items-center text-center"
      return `<div class="wrapped-card flex min-w-full flex-shrink-0 snap-center snap-always items-center justify-center p-8" data-card-type="${escapeHtml(c.type)}" role="group" aria-roledescription="slide">
        <div class="${innerClass}">${c.html}</div>
      </div>`
    }).join("")

    this.setupOverviewCountUp()

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

  setupOverviewCountUp() {
    const overviewCard = this.cardsContainerTarget?.querySelector('[data-card-type="overview"]')
    if (!overviewCard) return

    const targets = overviewCard.querySelectorAll(".count-up-target")
    if (targets.length === 0) return

    const DURATION = 1500
    const easeOutCubic = (t) => 1 - (1 - t) ** 3

    const animate = () => {
      targets.forEach((el) => {
        const target = parseInt(el.dataset.countTarget, 10)
        if (Number.isNaN(target)) return
        const start = 0
        const startTime = performance.now()

        const step = (now) => {
          const elapsed = now - startTime
          const progress = Math.min(elapsed / DURATION, 1)
          const eased = easeOutCubic(progress)
          const current = Math.round(start + (target - start) * eased)
          el.textContent = current
          if (progress < 1) requestAnimationFrame(step)
          else el.textContent = target
        }
        requestAnimationFrame(step)
      })
    }

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0]
        if (entry?.isIntersecting) {
          animate()
          observer.disconnect()
        }
      },
      { threshold: 0.5 }
    )
    observer.observe(overviewCard)
  }

  championAbilityVideoUrl(champ) {
    if (!champ) return ""
    const cid = champ.championId ?? champ["championId"] ?? champ.champion_id ?? champ["champion_id"]
    const id = parseInt(cid, 10)
    if (Number.isNaN(id) || id <= 0) return ""
    const padded = String(id).padStart(4, "0")
    return `https://d28xe8vt774jo5.cloudfront.net/champion-abilities/${padded}/ability_${padded}_R1.webm`
  }

  championSplashUrl(champ, _ddragonBase, champNames = {}) {
    if (!champ) return ""
    let charId = champ.key ?? champ["key"]
    if (!charId && champNames && champNames._splashKeys) {
      const cid = champ.championId ?? champ["championId"] ?? champ.champion_id ?? champ["champion_id"]
      charId = champNames._splashKeys[String(cid)]
    }
    if (charId && /^[a-zA-Z0-9_]+$/.test(String(charId))) {
      const name = String(charId).toLowerCase()
      // Community Dragon uses different filenames for some VGU champions (e.g. Viktor)
      const splashFilename = SPLASH_FILENAME_OVERRIDES[name] ?? `${name}_splash_centered_0.jpg`
      const skinDir = SPLASH_SKIN0_CHAMPIONS.includes(name) ? "skin0" : "base"
      return `https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global/default/assets/characters/${name}/skins/${skinDir}/images/${splashFilename}`
    }
    return ""
  }

  cardMostPlayedChampion(mostPlayed, champNames, ddragonBase) {
    const champId = mostPlayed.championId ?? mostPlayed["championId"] ?? mostPlayed.champion_id ?? mostPlayed["champion_id"]
    const name = mostPlayed.name ?? mostPlayed["name"] ?? champNames[String(champId)] ?? `Champion ${champId ?? ""}`
    const games = mostPlayed.games ?? mostPlayed["games"] ?? 0
    const winrate = mostPlayed.winrate ?? mostPlayed["winrate"]
    const kda = mostPlayed.kda ?? mostPlayed["kda"]
    const kills = kda?.kills ?? kda?.["kills"] ?? 0
    const deaths = kda?.deaths ?? kda?.["deaths"] ?? 0
    const assists = kda?.assists ?? kda?.["assists"] ?? 0
    const kdaStr = games > 0 ? `${Math.round(kills / games)} / ${Math.round(deaths / games)} / ${Math.round(assists / games)}` : ""
    const videoUrl = this.championAbilityVideoUrl(mostPlayed)
    const splashUrl = this.championSplashUrl(mostPlayed, ddragonBase, champNames)
    const iconUrl = this.championIconUrl(mostPlayed, ddragonBase, "https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global/default/v1/champion-icons")
    const posterUrl = splashUrl || iconUrl
    let mediaHtml = ""
    if (videoUrl) {
      const fallback = posterUrl ? `<img src="${escapeHtml(posterUrl)}" alt="" class="absolute inset-0 hidden h-full w-full object-cover" aria-hidden="true">` : ""
      mediaHtml = `<video src="${escapeHtml(videoUrl)}" poster="${escapeHtml(posterUrl || "")}" class="absolute inset-0 h-full w-full object-cover" autoplay loop muted playsinline onerror="this.style.display='none';const i=this.nextElementSibling;if(i)i.classList.remove('hidden')"></video>${fallback}`
    } else if (splashUrl) {
      mediaHtml = `<img src="${escapeHtml(splashUrl)}" alt="" class="absolute inset-0 h-full w-full object-cover">`
    } else if (iconUrl) {
      mediaHtml = `<img src="${escapeHtml(iconUrl)}" alt="" class="absolute inset-0 h-full w-full object-cover opacity-30">`
    }
    return `
      <p class="mb-4 text-sm font-semibold uppercase tracking-[0.25em] text-white">Most Played Champion</p>
      <div class="relative flex min-h-[280px] w-full items-end overflow-hidden rounded-xl bg-stone-800 sm:min-h-[320px] md:min-h-[360px]">
        ${mediaHtml}
        <div class="absolute inset-0 bg-gradient-to-t from-stone-950 via-stone-950/50 to-transparent"></div>
        <div class="relative z-10 w-full p-6 text-left">
          <h3 class="font-beaufort text-4xl font-bold text-white drop-shadow-lg sm:text-5xl">${escapeHtml(String(name))}</h3>
          <div class="mt-3 flex flex-wrap gap-x-6 gap-y-1 font-medium text-stone-200">
            <span>${escapeHtml(String(games))} Games</span>
            ${winrate != null ? `<span>${escapeHtml(Number(winrate).toFixed(0))}% WR</span>` : ""}
            ${kdaStr ? `<span>AVG: ${escapeHtml(kdaStr)} KDA</span>` : ""}
          </div>
        </div>
      </div>
    `
  }

  winrateColorClass(winrate) {
    if (winrate == null) return "text-stone-400"
    const w = Number(winrate)
    if (w >= 50) return "text-emerald-400"
    if (w >= 45) return "text-cyan-400"
    return "text-red-400"
  }

  cardChampionPool(champions, champNames, ddragonBase, cdragonBase) {
    const iconUrl = (c) => this.championIconUrl(c, ddragonBase, cdragonBase)
    const splashUrl = (c) => this.championSplashUrl(c, ddragonBase, champNames)
    const cards = champions.slice(0, 6).map((champ) => {
      const name = champ.name ?? champ["name"] ?? champNames[String(champ.championId ?? champ["championId"])] ?? `Champ ${champ.championId ?? ""}`
      const games = champ.games ?? champ["games"] ?? 0
      const winrate = champ.winrate ?? champ["winrate"]
      const wrClass = this.winrateColorClass(winrate)
      const splash = splashUrl(champ)
      const icon = iconUrl(champ)
      const imgSrc = splash || icon
      return `
        <div class="relative flex aspect-[3/4] shrink-0 flex-col overflow-hidden rounded-2xl bg-stone-900 shadow-2xl ring-1 ring-stone-700/50 ring-inset w-[140px] sm:w-[160px] md:w-[180px]" data-carousel-card>
          ${imgSrc ? `<img src="${escapeHtml(imgSrc)}" alt="" class="absolute inset-0 h-full w-full object-cover" onerror="this.style.display='none'">` : ""}
          <div class="absolute inset-0 bg-gradient-to-t from-stone-950 via-stone-900/20 to-transparent"></div>
          <div class="absolute inset-0 rounded-2xl ring-1 ring-white/5 ring-inset" aria-hidden="true"></div>
          <div class="relative z-10 mt-auto flex flex-col justify-end bg-gradient-to-t from-black/80 to-transparent p-4">
            <p class="font-beaufort text-lg font-bold tracking-wide text-white drop-shadow-[0_2px_8px_rgba(0,0,0,0.8)] sm:text-xl">${escapeHtml(String(name))}</p>
            <p class="mt-0.5 text-sm text-stone-300">${escapeHtml(String(games))} games</p>
            ${winrate != null ? `<p class="mt-0.5 text-sm font-semibold ${wrClass}">${escapeHtml(Number(winrate).toFixed(0))}% WR</p>` : ""}
          </div>
        </div>
      `
    }).join("")
    const cardsDuplicated = cards + cards
    return `
      <p class="mb-6 text-sm font-semibold uppercase tracking-[0.3em] text-white">Champion Pool</p>
      <div class="w-full overflow-hidden" data-controller="champion-pool-carousel">
        <div class="flex flex-nowrap gap-5" style="width: max-content" data-carousel-track>
          ${cardsDuplicated}
        </div>
      </div>
    `
  }

  cardMvpInsight(archetype, stats = []) {
    const label = String(archetype || "Player").trim()
    const statsList = Array.isArray(stats) ? stats : []
    const statsHtml = statsList
      .filter((s) => s && (s.label || s["label"]))
      .map((s) => {
        const l = s.label ?? s["label"]
        const v = s.value ?? s["value"]
        return `<li class="flex justify-between gap-6 text-stone-300"><span>${escapeHtml(String(l))}</span><span class="tabular-nums font-semibold text-white">${escapeHtml(String(v))}</span></li>`
      })
      .join("")
    const badgeImg = "https://raw.communitydragon.org/latest/plugins/rcp-fe-lol-static-assets/global/default/svg/hextech-chest-gold.svg"
    return `
      <p class="mb-6 text-sm font-semibold uppercase tracking-[0.3em] text-white">Your Playstyle</p>
      <div class="flex flex-col items-center gap-6">
        <img src="${escapeHtml(badgeImg)}" alt="" class="h-24 w-24 sm:h-28 sm:w-28 object-contain" onerror="this.style.display='none'">
        <p class="font-beaufort text-4xl sm:text-5xl md:text-6xl font-bold tracking-tight text-white whitespace-nowrap"><span class="text-white">You are a </span><span class="text-cyan-400">${escapeHtml(label)}</span></p>
      </div>
      ${statsHtml ? `<ul class="mt-8 flex flex-col gap-2 text-sm sm:text-base">${statsHtml}</ul>` : ""}
    `
  }

  cardBestAndWorstGame(bestGame, worstGame, champNames = {}, ddragonBase, cdragonBase) {
    const cardWrapper = (content, isMvp) => `
      <div class="rounded-2xl p-6">
        ${content}
      </div>
    `
    const bestHtml = !bestGame ? "" : (() => {
      const bg = bestGame
      const k = Number(bg.kills ?? bg["kills"] ?? 0)
      const d = Number(bg.deaths ?? bg["deaths"] ?? 0)
      const a = Number(bg.assists ?? bg["assists"] ?? 0)
      const damage = Number(bg.damage ?? bg["damage"] ?? 0)
      const sec = Number(bg.durationSeconds ?? bg["durationSeconds"] ?? 0)
      const mins = Math.floor(sec / 60)
      const damageStr = damage >= 1000 ? `${(damage / 1000).toFixed(0)}k` : String(damage)
      const champImg = this.championSplashUrl(bg, ddragonBase, champNames) || this.championIconUrl(bg, ddragonBase, cdragonBase)
      const imgHtml = champImg ? `<img src="${escapeHtml(champImg)}" alt="" class="absolute inset-0 h-full w-full object-cover" onerror="this.style.display='none'">` : ""
      const inner = `
        <p class="mb-4 text-xs font-semibold uppercase tracking-[0.35em] text-white">Best Game</p>
        <div class="relative flex flex-col items-center">
          <div class="relative aspect-[3/4] w-[280px] sm:w-[320px] overflow-hidden rounded-xl shadow-2xl">
            ${imgHtml}
            <div class="absolute inset-0 bg-gradient-to-t from-black/90 via-black/30 to-transparent"></div>
            <div class="absolute inset-x-0 bottom-0 p-4 text-center">
              <p class="font-beaufort text-4xl sm:text-5xl font-bold tracking-tight text-white tabular-nums drop-shadow-[0_2px_8px_rgba(0,0,0,0.9)]">${k} <span class="text-white/60">/</span> ${d} <span class="text-white/60">/</span> ${a}</p>
            </div>
          </div>
        </div>
        <p class="mt-5 text-2xl font-bold text-cyan-400 tabular-nums">${escapeHtml(damageStr)} damage</p>
        <p class="mt-1 text-lg text-stone-400">${mins} min</p>
      `
      return cardWrapper(inner, true)
    })()
    const worstHtml = !worstGame ? "" : (() => {
      const wg = worstGame
      const k = Number(wg.kills ?? wg["kills"] ?? 0)
      const d = Number(wg.deaths ?? wg["deaths"] ?? 0)
      const a = Number(wg.assists ?? wg["assists"] ?? 0)
      const champImg = this.championSplashUrl(wg, ddragonBase, champNames) || this.championIconUrl(wg, ddragonBase, cdragonBase)
      const imgHtml = champImg ? `<img src="${escapeHtml(champImg)}" alt="" class="absolute inset-0 h-full w-full object-cover opacity-95" onerror="this.style.display='none'">` : ""
      const inner = `
        <p class="mb-4 text-xs font-semibold uppercase tracking-[0.35em] text-white">Worst Game</p>
        <div class="relative flex flex-col items-center">
          <div class="relative aspect-[3/4] w-[280px] sm:w-[320px] overflow-hidden rounded-xl shadow-2xl">
            ${imgHtml}
            <div class="absolute inset-0 bg-gradient-to-t from-black/90 via-black/30 to-transparent"></div>
            <div class="absolute inset-x-0 bottom-0 p-4 text-center">
              <p class="font-beaufort text-4xl sm:text-5xl font-bold tracking-tight text-red-400 tabular-nums drop-shadow-[0_2px_8px_rgba(0,0,0,0.9)]">${k} <span class="text-white/50">/</span> ${d} <span class="text-white/50">/</span> ${a}</p>
            </div>
          </div>
        </div>
        <p class="mt-5 text-xl font-medium italic text-stone-400">We won't talk about this one.</p>
      `
      return cardWrapper(inner, false)
    })()
    const bothExist = bestHtml && worstHtml
    if (bothExist) {
      return `
        <div class="grid w-full grid-cols-1 gap-10 md:grid-cols-2 md:gap-14">
          <div class="flex flex-col items-center text-center">${bestHtml}</div>
          <div class="flex flex-col items-center text-center">${worstHtml}</div>
        </div>
      `
    }
    return `<div class="flex flex-col items-center text-center">${bestHtml || worstHtml}</div>`
  }

  cardSeasonKda(totalKills, totalDeaths, totalAssists, gamesCount) {
    const games = Math.floor(Number(gamesCount) || 0)
    if (games <= 0) return ""
    const totalK = Number(totalKills) || 0
    const totalD = Number(totalDeaths) || 0
    const totalA = Number(totalAssists) || 0
    const avgKills = Math.round(totalK / games)
    const avgDeaths = Math.round(totalD / games)
    const avgAssists = Math.round(totalA / games)
    const row = (n1, n2, n3, sizeClass) =>
      `<div class="flex flex-col items-center gap-1">
        <span class="font-beaufort ${sizeClass} font-bold tabular-nums tracking-tight">
          <span class="text-blue-400">${escapeHtml(String(n1))}</span>
          <span class="text-white"> / </span>
          <span class="text-red-400">${escapeHtml(String(n2))}</span>
          <span class="text-white"> / </span>
          <span class="text-green-400">${escapeHtml(String(n3))}</span>
        </span>
      </div>`
    return `
      <div class="flex flex-col items-center gap-12">
        <p class="font-beaufort text-sm font-semibold uppercase tracking-[0.25em] text-white">Season KDA</p>
        <div class="flex flex-col items-center gap-8">
          <div>
            <p class="mb-2 font-beaufort text-sm font-medium uppercase tracking-[0.2em] text-stone-400">AVG per game</p>
            ${row(avgKills, avgDeaths, avgAssists, "text-5xl sm:text-6xl md:text-7xl")}
          </div>
          <div class="border-t border-stone-600 pt-6">
            <p class="mb-2 font-beaufort text-xs font-medium uppercase tracking-[0.2em] text-stone-400">Total</p>
            ${row(totalK, totalD, totalA, "text-3xl sm:text-4xl md:text-5xl")}
          </div>
        </div>
      </div>
    `
  }

  cardMultiKills(multiKills, champNames = {}, ddragonBase, cdragonBase) {
    const double = Number(multiKills.doubleKills ?? multiKills["doubleKills"] ?? 0)
    const triple = Number(multiKills.tripleKills ?? multiKills["tripleKills"] ?? 0)
    const quadra = Number(multiKills.quadraKills ?? multiKills["quadraKills"] ?? 0)
    const penta = Number(multiKills.pentaKills ?? multiKills["pentaKills"] ?? 0)
    if (double === 0 && triple === 0 && quadra === 0 && penta === 0) return ""
    const byChampion = multiKills.byChampion ?? multiKills["byChampion"] ?? []
    const top3 = (key) =>
      byChampion
        .filter((e) => (Number(e[key] ?? 0)) > 0)
        .sort((a, b) => (Number(b[key] ?? 0)) - (Number(a[key] ?? 0)))
        .slice(0, 3)
    const iconUrl = (entry) =>
      this.championIconUrl({ championId: entry.championId ?? entry["championId"], key: entry.key ?? entry["key"] }, ddragonBase, cdragonBase)
    const iconsHtml = (champs, key) => {
      const imgs = champs.map((c) => {
        const url = iconUrl(c)
        const count = Number(c[key] ?? 0)
        const name = c.name ?? c["name"] ?? ""
        const label = name ? `${escapeHtml(String(name))}: ${count}` : String(count)
        return url
          ? `<span class="group relative inline-block">
              <img src="${escapeHtml(url)}" alt="" class="h-8 w-8 rounded-full ring-1 ring-stone-600 cursor-help transition-transform duration-150 hover:scale-110" aria-label="${label}" onerror="this.style.display='none'">
              <span class="pointer-events-none absolute bottom-full left-1/2 z-20 mb-1 -translate-x-1/2 whitespace-nowrap rounded bg-stone-800 px-2 py-1 text-xs font-medium text-white ring-1 ring-stone-600 opacity-0 transition-opacity duration-75 group-hover:opacity-100">${label}</span>
            </span>`
          : ""
      }).filter(Boolean)
      return imgs.length > 0 ? `<div class="mt-2 flex justify-center gap-1">${imgs.join("")}</div>` : ""
    }
    const stat = (num, label, champs, key) =>
      `<div class="flex flex-col items-center gap-1">
        <span class="font-beaufort text-sm font-medium uppercase tracking-wider text-stone-500">${escapeHtml(label)}</span>
        <span class="font-beaufort text-5xl sm:text-6xl md:text-7xl font-bold tabular-nums tracking-tight text-white">${escapeHtml(String(num))}</span>
        ${iconsHtml(champs, key)}
      </div>`
    const dKey = "doubleKills"
    const tKey = "tripleKills"
    const qKey = "quadraKills"
    const pKey = "pentaKills"
    return `
      <div class="flex flex-col items-center gap-12">
        <p class="font-beaufort text-sm font-semibold uppercase tracking-[0.25em] text-white">Multi-Kills</p>
        <div class="grid grid-cols-2 gap-8 sm:gap-12">
          ${stat(double, "Double Kills", top3(dKey), dKey)}
          ${stat(triple, "Triple Kills", top3(tKey), tKey)}
          ${stat(quadra, "Quadra Kills", top3(qKey), qKey)}
          ${stat(penta, "Penta Kills", top3(pKey), pKey)}
        </div>
      </div>
    `
  }

  cardEmptyNoGames(year, playerRiotId, profileIconUrl) {
    const y = year || new Date().getFullYear()
    const initial = (playerRiotId || "S").charAt(0).toUpperCase()
    const safeUrl = safeProfileIconUrl(profileIconUrl)
    const avatarHtml = safeUrl
      ? `<img src="${escapeHtml(safeUrl)}" alt="" class="h-full w-full object-cover" onerror="this.classList.add('hidden');this.nextElementSibling.classList.remove('hidden')"><span class="hidden font-beaufort text-6xl font-bold text-white">${escapeHtml(initial)}</span>`
      : `<span class="font-beaufort text-6xl font-bold text-white">${escapeHtml(initial)}</span>`
    return `
      <div class="flex flex-col items-center gap-8 text-center">
        <h2 class="font-beaufort text-5xl font-bold text-white">${escapeHtml(playerRiotId || "Summoner")}</h2>
        <div class="flex h-40 w-40 shrink-0 items-center justify-center overflow-hidden rounded-full bg-stone-500/30">
          ${avatarHtml}
        </div>
        <p class="font-beaufort text-4xl sm:text-5xl font-bold text-white">0 games in ${escapeHtml(String(y))}</p>
        <p class="font-beaufort text-lg sm:text-xl text-stone-300">Congratulations, you played no games in ${escapeHtml(String(y))}.</p>
      </div>
    `
  }

  cardOverview(gamesCount, totalGameSeconds, uniqueChampions) {
    const games = Math.floor(Number(gamesCount) || 0)
    const hours = Math.floor((Number(totalGameSeconds) || 0) / 3600)
    const champions = Math.floor(Number(uniqueChampions) || 0)
    const stat = (num, label) =>
      `<div class="flex flex-col items-center gap-1">
        <span class="count-up-target font-beaufort text-6xl sm:text-7xl md:text-8xl font-bold tabular-nums tracking-tight text-white" data-count-target="${num}">0</span>
        <span class="font-beaufort text-base sm:text-lg font-medium uppercase tracking-[0.2em] text-stone-400">${escapeHtml(label)}</span>
      </div>`
    return `
      <div class="flex flex-col items-center gap-12 sm:gap-16">
        ${games > 0 ? stat(games, "Games Played") : ""}
        ${hours > 0 ? stat(hours, "Hours") : ""}
        ${champions > 0 ? stat(champions, "Champions") : ""}
      </div>
    `
  }

  cardIntro(playerRiotId, year, profileIconUrl) {
    const initial = (playerRiotId || "S").charAt(0).toUpperCase()
    const safeUrl = safeProfileIconUrl(profileIconUrl)
    const avatarHtml = safeUrl
      ? `<img src="${escapeHtml(safeUrl)}" alt="" class="h-full w-full object-cover" onerror="this.classList.add('hidden');this.nextElementSibling.classList.remove('hidden')"><span class="hidden font-beaufort text-6xl font-bold text-white">${escapeHtml(initial)}</span>`
      : `<span class="font-beaufort text-6xl font-bold text-white">${escapeHtml(initial)}</span>`
    return `
      <p class="font-beaufort text-3xl font-medium uppercase tracking-widest text-white">Your ${escapeHtml(String(year))} LoL Wrapped</p>
      <div class="my-8 flex h-40 w-40 shrink-0 items-center justify-center overflow-hidden rounded-full bg-stone-500/30">
        ${avatarHtml}
      </div>
      <h2 class="font-beaufort text-5xl font-bold text-white">${escapeHtml(playerRiotId || "Summoner")}</h2>
      <p class="mt-6 font-beaufort text-lg text-stone-400">Swipe to see your stats</p>
    `
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

  cardFriendsAndFoes(list, enemies) {
    const topFriends = list.slice(0, 5)
    const topFoes = enemies.slice(0, 5)
    const friendsHtml = topFriends.length > 0
      ? `<div>
          <p class="mb-3 text-xs font-semibold uppercase tracking-wider text-emerald-500">Most played with</p>
          <div class="space-y-3">
            ${topFriends.map((r, i) => {
              const name = escapeHtml(r.teammate_name || r.teammate_riot_id || "Unknown")
              const games = r.games ?? 0
              const wins = r.wins_together ?? r["wins_together"] ?? 0
              const wr = games > 0 && wins != null ? `${Math.round(100 * wins / games)}% WR` : null
              return `<div class="flex flex-col gap-0.5"><div class="text-lg"><span class="font-bold text-white">#${i + 1}</span> ${name}</div><div class="text-sm text-stone-500">${wr ? `${wr} · ` : ""}${safeDisplay(games)} games</div></div>`
            }).join("")}
          </div>
        </div>`
      : `<div>
          <p class="mb-3 text-xs font-semibold uppercase tracking-wider text-stone-500">Most played with</p>
          <p class="text-stone-500">No data</p>
        </div>`
    const foesHtml = topFoes.length > 0
      ? `<div>
          <p class="mb-3 text-xs font-semibold uppercase tracking-wider text-red-400">Most lost to</p>
          <div class="space-y-3">
            ${topFoes.map((r, i) => {
              const name = escapeHtml(r.enemy_name || r.enemy_riot_id || "Unknown")
              return `<div class="flex flex-col gap-0.5"><div class="text-lg"><span class="font-bold text-red-400">#${i + 1}</span> ${name}</div><div class="text-sm text-stone-500">Beat you <span class="text-white">${safeDisplay(r.times_beat_us)}</span>×</div></div>`
            }).join("")}
          </div>
        </div>`
      : `<div>
          <p class="mb-3 text-xs font-semibold uppercase tracking-wider text-stone-500">Most lost to</p>
          <p class="text-stone-500">No data</p>
        </div>`
    return `
      <p class="mb-6 text-sm font-semibold uppercase tracking-[0.3em] text-white">Friends and foes</p>
      <div class="grid w-full max-w-2xl grid-cols-1 gap-8 md:grid-cols-2 md:gap-12">
        ${friendsHtml}
        ${foesHtml}
      </div>
    `
  }

  cardItems(favItems, itemNames = {}, ITEM_IMG_BASE) {
    const items = favItems.filter((item) => item && ((item.item_id ?? item.itemId) != null)).slice(0, 8)
    return `
      <p class="text-xs font-medium uppercase tracking-widest text-white">Top 8 items built</p>
      <div class="mt-6 grid grid-cols-4 gap-4">
        ${items.map((item) => {
          const id = safeUrlSegment(item.item_id ?? item.itemId)
          const count = item.count ?? 0
          return `<div class="flex flex-col items-center"><img src="${ITEM_IMG_BASE}/${id}.png" alt="" class="h-14 w-14 rounded" onerror="this.style.display='none'"><span class="mt-2 text-white font-semibold">${safeDisplay(count)} games</span></div>`
        }).join("")}
      </div>
    `
  }

  cardPings(pingBreakdown, totalPings) {
    const raw = pingBreakdown || {}
    const merged = { ...raw }
    const getBack = (Number(merged.getBackPings) || 0) + (Number(merged.retreatPings) || 0)
    if (getBack > 0) {
      merged.getBackPings = getBack
      delete merged.retreatPings
    }
    const entries = Object.entries(merged)
      .filter(([, count]) => (Number(count) || 0) > 0)
      .map(([key, count]) => ({ key, count: Number(count) }))
      .sort((a, b) => b.count - a.count)
    if (entries.length === 0) return ""
    const cells = Array.from({ length: 10 }, (_, i) => {
      const entry = entries[i]
      if (!entry) {
        return `<div class="flex flex-col items-center justify-center gap-1 rounded-xl p-4 min-h-[100px] aspect-square"></div>`
      }
      const { key, count } = entry
      const label = pingKeyToLabel(key)
      const iconUrl = PING_ICON_URLS[key]
      const iconHtml = iconUrl
        ? `<img src="${escapeHtml(iconUrl)}" alt="" class="h-12 w-12 shrink-0 object-contain" onerror="this.style.display='none';this.nextElementSibling?.classList.remove('hidden')">
          <span class="hidden flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-[#22d3ee]/20 text-lg font-bold text-white">${escapeHtml(String(label.charAt(0)))}</span>`
        : `<span class="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-[#22d3ee]/20 text-lg font-bold text-white">${escapeHtml(String(label.charAt(0)))}</span>`
      return `<div class="flex flex-col items-center justify-center gap-2 rounded-xl p-4 min-h-[100px] aspect-square" title="${escapeHtml(label)}">
        <div class="flex flex-col items-center gap-1">
          <div class="flex items-center justify-center">${iconHtml}</div>
          <span class="text-center text-xs font-medium text-white leading-tight">${escapeHtml(label)}</span>
        </div>
        <span class="font-beaufort text-2xl font-bold tabular-nums text-white">${escapeHtml(String(count))}</span>
      </div>`
    })
    return `
      <p class="mb-6 text-sm font-semibold uppercase tracking-[0.3em] text-white">Your Pings</p>
      <div class="flex flex-col items-center gap-6">
        <p class="font-beaufort text-5xl sm:text-6xl font-bold tabular-nums tracking-tight text-white">
          <span class="text-white">${escapeHtml(String(totalPings))}</span>
          <span class="text-lg sm:text-xl font-medium text-white ml-1">total pings</span>
        </p>
        <div class="flex w-full max-w-2xl flex-col items-center gap-4">
          <div class="grid w-full grid-cols-4 gap-3 sm:gap-4">${cells.slice(0, 4).join("")}</div>
          <div class="grid w-full grid-cols-4 gap-3 sm:gap-4">${cells.slice(4, 8).join("")}</div>
          <div class="grid w-full grid-cols-4 gap-3 sm:gap-4">${cells.slice(8, 10).join("")}</div>
        </div>
      </div>
    `
  }

  cardThankYou() {
    const homeUrl = "/"
    return `
      <div class="flex flex-col items-center gap-8">
        <p class="font-beaufort text-4xl sm:text-5xl font-bold tracking-tight text-white">Thank you</p>
        <p class="text-stone-400 text-center max-w-sm">Thanks for using LoL Wrapped. If you enjoyed it, consider supporting development.</p>
        <a href="https://ko-fi.com/ethancodes" target="_blank" rel="noopener noreferrer" class="group inline-flex items-center gap-3 rounded-lg bg-white px-6 py-3 text-black font-medium ring-1 ring-stone-800 transition-all duration-300 hover:scale-105 hover:-translate-y-1 hover:bg-white hover:shadow-[0_8px_30px_rgba(255,255,255,0.25)] hover:ring-white focus:outline-none focus:ring-2 focus:ring-white focus:ring-offset-2 focus:ring-offset-stone-950">
          <img src="/Ko-fi_HEART.gif" alt="" class="h-12 w-12 object-contain transition-transform duration-300 group-hover:scale-110">
          <span class="transition-transform duration-300 group-hover:translate-x-0.5">Support on Ko-fi</span>
        </a>
        <a href="${escapeHtml(homeUrl)}" class="text-sm text-stone-500 hover:text-white transition-colors">Take me back home</a>
      </div>
    `
  }

  cardBans(ourTeamBans, enemyTeamBans, champNames = {}, CHAMP_IMG_DDRAGON, CHAMP_IMG_CDRAGON) {
    const topOur = ourTeamBans.slice(0, 5)
    const topEnemy = enemyTeamBans.slice(0, 5)
    const banImg = (b) => {
      const url = this.championIconUrl({ key: b.key, championId: b.champion_id }, CHAMP_IMG_DDRAGON, CHAMP_IMG_CDRAGON)
      return url ? `<img src="${escapeHtml(url)}" alt="" class="h-8 w-8 shrink-0 rounded-full" onerror="this.style.display='none'">` : ""
    }
    const banName = (b) => b.name ?? b["name"] ?? champNames[String(b.champion_id ?? b.championId ?? "")] ?? `Champ ${b.champion_id ?? b.championId ?? ""}`
    return `
      <p class="text-xs font-medium uppercase tracking-widest text-white">Top 5 bans</p>
      <div class="mt-6 grid grid-cols-2 gap-6">
        <div>
          <p class="mb-2 text-xs text-stone-500">Your team</p>
          <div class="space-y-2">
            ${topOur.map((b) => {
              const name = escapeHtml(banName(b))
              const count = safeDisplay(b.count)
              return `<div class="flex items-center justify-between gap-2"><div class="flex items-center gap-2 min-w-0">${banImg(b)}<span class="text-stone-300 truncate">${name}</span></div><span class="text-white font-semibold shrink-0">${count}×</span></div>`
            }).join("")}
          </div>
        </div>
        <div>
          <p class="mb-2 text-xs text-stone-500">Enemy team</p>
          <div class="space-y-2">
            ${topEnemy.map((b) => {
              const name = escapeHtml(banName(b))
              const count = safeDisplay(b.count)
              return `<div class="flex items-center justify-between gap-2"><div class="flex items-center gap-2 min-w-0">${banImg(b)}<span class="text-stone-300 truncate">${name}</span></div><span class="text-red-400 font-semibold shrink-0">${count}×</span></div>`
            }).join("")}
          </div>
        </div>
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
    this.messageTarget.classList.remove("text-white", "text-red-400", "text-stone-400")
    this.messageTarget.classList.add(type === "success" ? "text-white" : type === "error" ? "text-red-400" : "text-stone-400")
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
