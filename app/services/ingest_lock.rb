# frozen_string_literal: true

# Redis lock to prevent duplicate recap ingestion for a player.
# One ingestion per player at a time (any year).
class IngestLock
  LOCK_TTL = 2.hours.to_i # Safety: auto-expire if job crashes

  def initialize(redis: nil)
    @redis = redis || Redis.new(url: ENV.fetch("REDIS_URL", "redis://localhost:6379/0"))
  end

  def lock_key(player_id)
    "player:#{player_id}:ingesting"
  end

  def locked?(player_id)
    @redis.exists?(lock_key(player_id))
  end

  def acquire!(player_id)
    key = lock_key(player_id)
    @redis.set(key, Time.current.to_i, ex: LOCK_TTL)
  end

  def release!(player_id)
    @redis.del(lock_key(player_id))
  end
end
