# frozen_string_literal: true

# Redis-backed progress store for match ingestion. Exposes phase, downloaded count,
# and job_id for queue position lookup.
class IngestProgress
  TTL = 2.hours.to_i # Align with IngestLock

  def initialize(redis: nil)
    @redis = redis || Redis.new(url: ENV.fetch("REDIS_URL", "redis://localhost:6379/0"))
  end

  def key(player_id, year)
    "ingest_progress:#{player_id}:#{year}"
  end

  def set_progress(player_id, year, phase: nil, downloaded: nil, processed: nil, job_id: nil)
    data = get_progress(player_id, year)&.symbolize_keys || {}
    data[:phase] = phase if phase.present?
    data[:downloaded] = downloaded unless downloaded.nil?
    data[:processed] = processed unless processed.nil?
    data[:job_id] = job_id if job_id.present?
    @redis.set(key(player_id, year), data.to_json, ex: TTL)
  end

  def get_progress(player_id, year)
    raw = @redis.get(key(player_id, year))
    return nil if raw.blank?

    JSON.parse(raw)
  rescue JSON::ParserError
    nil
  end

  def clear(player_id, year)
    @redis.del(key(player_id, year))
  end
end
