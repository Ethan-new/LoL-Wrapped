# frozen_string_literal: true

# Rate limiting to protect against abuse, DoS, and Riot API exhaustion.
# Uses Rails.cache by default; configure Redis cache in production for multi-process.
# See https://github.com/rack/rack-attack

Rack::Attack.throttled_responder = lambda do |request|
  [429, { "Content-Type" => "application/json" }, ['{"error":"Too many requests. Please try again later."}']]
end

Rack::Attack.throttle("players/lookup", limit: 10, period: 1.minute) do |req|
  req.ip if req.path == "/players/lookup" && req.post?
end

Rack::Attack.throttle("players/ingest", limit: 5, period: 5.minutes) do |req|
  req.ip if req.path.match?(%r{\A/players/\d+/ingest_year\z}) && req.post?
end

Rack::Attack.throttle("players/compute", limit: 10, period: 1.minute) do |req|
  req.ip if req.path.match?(%r{\A/players/\d+/compute_recap\z}) && req.post?
end

Rack::Attack.throttle("req/ip", limit: 60, period: 1.minute) do |req|
  req.ip if req.post? || req.patch? || req.put? || req.delete?
end
