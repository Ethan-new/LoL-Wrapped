# frozen_string_literal: true

# Enforces Riot API rate limits globally via Redis.
# MUST be called before every Riot HTTP request.
#
# Limits:
# - 20 requests per 1 second (burst)
# - 100 requests per 120 seconds (sustained rolling window)
#
# Safe under Sidekiq concurrency (global limiter).
class RateLimiter
  BURST_LIMIT = 20
  BURST_WINDOW = 1
  SUSTAINED_LIMIT = 100
  SUSTAINED_WINDOW_MS = 120_000

  def initialize(redis: nil)
    @redis = redis || Redis.new(url: ENV.fetch("REDIS_URL", "redis://localhost:6379/0"))
  end

  # Blocks until a request slot is available. Call before each Riot HTTP request.
  def acquire!
    acquire_burst_slot!
    acquire_sustained_slot!
  end

  private

  attr_reader :redis

  def acquire_burst_slot!
    loop do
      now = Time.now.to_i
      key = "riot:rl:1s:#{now}"
      count = redis.incr(key)
      redis.expire(key, 2) # expire after window

      return if count <= BURST_LIMIT

      # Sleep until next second boundary
      sleep_until = now + 1
      sleep([sleep_until - Time.now.to_f, 0.1].max)
    end
  end

  def acquire_sustained_slot!
    sustained_key = "riot:rl:120s"
    loop do
      now_ms = (Time.now.to_f * 1000).to_i
      window_start = now_ms - SUSTAINED_WINDOW_MS

      redis.zremrangebyscore(sustained_key, 0, window_start)
      redis.expire(sustained_key, 180)

      current = redis.zcard(sustained_key)
      if current < SUSTAINED_LIMIT
        redis.zadd(sustained_key, now_ms, "#{now_ms}-#{SecureRandom.hex(8)}")
        return
      end

      oldest_entry = redis.zrange(sustained_key, 0, 0, with_scores: true)
      oldest_ms = oldest_entry.dig(0, 1)
      break unless oldest_ms

      sleep_seconds = ((oldest_ms + SUSTAINED_WINDOW_MS - now_ms) / 1000.0).round(3)
      sleep_seconds = [[sleep_seconds, 0.1].max, 10.0].min
      sleep(sleep_seconds)
    end
  end
end
