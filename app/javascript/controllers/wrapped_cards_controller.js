import { Controller } from "@hotwired/stimulus"

// Carousel controller for Spotify Wrapped-style cards.
// Handles keyboard navigation and progress dots (swipe/scroll for cards).
export default class extends Controller {
  static targets = ["scrollContainer", "dots", "prevButton", "nextButton"]

  connect() {
    this.updateDots()
    this.updateArrows()
    this.scrollContainerTarget.addEventListener("scroll", () => this.onScroll())
    document.addEventListener("keydown", this.boundKeydown = (e) => this.onKeydown(e))
  }

  disconnect() {
    document.removeEventListener("keydown", this.boundKeydown)
  }

  onScroll() {
    this.updateDots()
    this.updateArrows()
  }

  updateArrows() {
    if (!this.hasPrevButtonTarget || !this.hasNextButtonTarget) return
    const cards = this.cards
    const idx = this.currentIndex
    this.prevButtonTarget.disabled = cards.length <= 1 || idx <= 0
    this.nextButtonTarget.disabled = cards.length <= 1 || idx >= cards.length - 1
  }

  onKeydown(e) {
    if (e.key === "ArrowLeft") {
      e.preventDefault()
      this.prev()
    } else if (e.key === "ArrowRight") {
      e.preventDefault()
      this.next()
    }
  }

  prev() {
    this.scrollToIndex(this.currentIndex - 1)
  }

  next() {
    this.scrollToIndex(this.currentIndex + 1)
  }

  scrollToIndex(index) {
    const cards = this.cards
    if (cards.length === 0 || index < 0 || index >= cards.length) return

    const card = cards[index]
    card.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" })
  }

  get cards() {
    if (!this.hasScrollContainerTarget) return []
    return Array.from(this.scrollContainerTarget.children).filter(
      (el) => el.classList.contains("wrapped-card")
    )
  }

  get currentIndex() {
    const cards = this.cards
    if (cards.length === 0) return 0

    const scrollLeft = this.scrollContainerTarget.scrollLeft
    const containerWidth = this.scrollContainerTarget.offsetWidth
    const viewportCenter = scrollLeft + containerWidth / 2

    let closestIdx = 0
    let closestDist = Infinity
    for (let i = 0; i < cards.length; i++) {
      const card = cards[i]
      const cardCenter = card.offsetLeft + card.offsetWidth / 2
      const dist = Math.abs(viewportCenter - cardCenter)
      if (dist < closestDist) {
        closestDist = dist
        closestIdx = i
      }
    }
    return closestIdx
  }

  updateDots() {
    if (!this.hasDotsTarget) return

    const cards = this.cards
    const idx = this.currentIndex

    this.dotsTarget.innerHTML = cards.map((_, i) => {
      const active = i === idx
      return `<button type="button" data-index="${i}" class="h-2 w-2 rounded-full transition-colors ${active ? "bg-white" : "bg-stone-600 hover:bg-stone-500"} aria-label="Go to card ${i + 1} of ${cards.length}" aria-current="${active ? "true" : "false"}"></button>`
    }).join("")
  }

  dotsClick(e) {
    const btn = e.target.closest("[data-index]")
    if (!btn) return
    const idx = parseInt(btn.dataset.index, 10)
    if (!Number.isNaN(idx)) this.scrollToIndex(idx)
  }

  // Called by recap controller after injecting cards (or when cards change)
  refresh() {
    this.updateDots()
    this.updateArrows()
  }
}
