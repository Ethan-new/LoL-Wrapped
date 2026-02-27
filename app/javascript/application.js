// Configure your import map in config/importmap.rb. Read more: https://github.com/rails/importmap-rails
import "@hotwired/turbo-rails"
import "controllers"

// Break out of Turbo Frame when redirect targets a page without that frame (e.g. lookup success -> player page)
document.addEventListener("turbo:frame-missing", (event) => {
  const response = event.detail?.response ?? event.detail?.fetchResponse
  if (response?.redirected && response?.url) {
    event.preventDefault()
    window.Turbo.visit(response.url)
  }
})
