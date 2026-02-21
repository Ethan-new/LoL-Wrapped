# frozen_string_literal: true

require "faraday"

class RiotClient
  class NotFound < StandardError; end
  class ApiError < StandardError; end
  class ArgumentError < StandardError; end

  BASE_URL_TEMPLATE = "https://%<region>s.api.riotgames.com"
  VALID_REGIONS = %w[americas europe asia sea].freeze
  MAX_RETRIES = 5
  OPEN_TIMEOUT = 10
  READ_TIMEOUT = 30

  # Summoner-v4 uses platform routing; try platforms in order until one returns data
  REGION_PLATFORMS = {
    "americas" => %w[na1 br1 la1 la2],
    "europe" => %w[euw1 eun1 tr1 ru],
    "asia" => %w[kr jp1],
    "sea" => %w[oc1 ph2 sg2 th2 tw2 vn2]
  }.freeze

  def initialize(api_key: ENV["RIOT_API_KEY"], rate_limiter: RateLimiter.new)
    @api_key = api_key
    @rate_limiter = rate_limiter
  end

  def fetch_summoner_by_puuid(puuid:, region:)
    platforms = REGION_PLATFORMS[region.to_s.downcase] || [ region ]
    last_error = nil

    platforms.each do |platform|
      base_url = BASE_URL_TEMPLATE % { region: platform }
      path = "/lol/summoner/v4/summoners/by-puuid/#{puuid}"

      response = http_get("#{base_url}#{path}")

      case response.status
      when 200
        data = JSON.parse(response.body, symbolize_names: true)
        return { data: data, platform: platform }
      when 404
        next
      else
        last_error = ApiError.new("Riot API error: #{response.status}")
      end
    end

    raise last_error || NotFound.new("Summoner not found in region")
  end

  def fetch_league_entries_by_puuid(puuid:, region:, platform: nil)
    platforms = platform ? [ platform ] : (REGION_PLATFORMS[region.to_s.downcase] || [ region ])

    platforms.each do |plat|
      base_url = BASE_URL_TEMPLATE % { region: plat }
      path = "/lol/league/v4/entries/by-puuid/#{puuid}"

      response = http_get("#{base_url}#{path}")

      if response.status == 200
        parsed = JSON.parse(response.body, symbolize_names: true)
        Rails.logger.info "[RiotClient] league-v4 by-puuid #{plat}: 200, #{parsed.size} entries"
        return parsed
      end

      Rails.logger.warn "[RiotClient] league-v4 by-puuid #{plat}: #{response.status}" if response.status != 404
      next if response.status == 404
    end

    Rails.logger.warn "[RiotClient] league-v4 by-puuid: no entries from any platform"
    []
  end

  def fetch_account_by_puuid(puuid:, region:)
    validate_region!(region)

    base_url = BASE_URL_TEMPLATE % { region: region }
    path = "/riot/account/v1/accounts/by-puuid/#{puuid}"

    response = http_get("#{base_url}#{path}")

    case response.status
    when 200
      JSON.parse(response.body, symbolize_names: true)
    when 404
      raise NotFound, "Account not found for puuid"
    else
      raise ApiError, "Riot API error: #{response.status}"
    end
  end

  def fetch_account_by_riot_id(game_name:, tag_line:, region:)
    validate_region!(region)

    base_url = BASE_URL_TEMPLATE % { region: region }
    encoded_game_name = ERB::Util.url_encode(game_name)
    encoded_tag_line = ERB::Util.url_encode(tag_line)
    path = "/riot/account/v1/accounts/by-riot-id/#{encoded_game_name}/#{encoded_tag_line}"

    response = http_get("#{base_url}#{path}")

    case response.status
    when 200
      JSON.parse(response.body, symbolize_names: true)
    when 404
      raise NotFound, "Riot account not found"
    else
      raise ApiError, "Riot API error: #{response.status}"
    end
  end

  # Match-v5: list match IDs by PUUID (regional routing cluster)
  def fetch_match_ids_by_puuid(puuid:, region:, start: 0, count: 100)
    validate_region!(region)

    base_url = BASE_URL_TEMPLATE % { region: region }
    path = "/lol/match/v5/matches/by-puuid/#{puuid}/ids"
    url = "#{base_url}#{path}?start=#{start}&count=#{count}"

    response = http_get(url)

    case response.status
    when 200
      JSON.parse(response.body, symbolize_names: false)
    when 404
      raise NotFound, "Matches not found"
    else
      raise ApiError, "Riot API error: #{response.status}"
    end
  end

  # Match-v5: get match details
  def fetch_match(match_uid:, region:)
    validate_region!(region)

    base_url = BASE_URL_TEMPLATE % { region: region }
    path = "/lol/match/v5/matches/#{ERB::Util.url_encode(match_uid)}"
    url = "#{base_url}#{path}"

    response = http_get(url)

    case response.status
    when 200
      JSON.parse(response.body, symbolize_names: true)
    when 404
      raise NotFound, "Match not found: #{match_uid}"
    else
      raise ApiError, "Riot API error: #{response.status}"
    end
  end

  private

  attr_reader :api_key, :rate_limiter

  def validate_region!(region)
    return if VALID_REGIONS.include?(region.to_s.downcase)

    raise ::ArgumentError, "Invalid region: #{region}. Must be one of: #{VALID_REGIONS.join(', ')}"
  end

  def http_get(url)
    retries = 0

    loop do
      rate_limiter.acquire!

      response = begin
        conn = Faraday.new do |f|
          f.options.open_timeout = OPEN_TIMEOUT
          f.options.timeout = READ_TIMEOUT
        end

        conn.get(url) do |req|
          req.headers["X-Riot-Token"] = api_key
          req.headers["Accept"] = "application/json"
        end
      rescue Faraday::Error => e
        retries += 1
        raise ApiError, "Riot API error: #{e.message}" if retries > MAX_RETRIES

        sleep_seconds = backoff_with_jitter(retries)
        Rails.logger.warn "[RiotClient] Network error, retry #{retries}/#{MAX_RETRIES}: #{e.message}"
        sleep(sleep_seconds)
        retry
      end

      case response.status
      when 200, 404
        return response
      when 429
        retry_after = response.headers["retry-after"].to_i
        sleep_seconds = retry_after.positive? ? retry_after : backoff_with_jitter(retries)
        retries += 1
        raise ApiError, "Rate limited, max retries exceeded" if retries > MAX_RETRIES

        Rails.logger.warn "[RiotClient] 429 Rate limited, sleeping #{sleep_seconds}s (retry #{retries})"
        sleep(sleep_seconds)
      when 500..599
        retries += 1
        raise ApiError, "Riot API error: #{response.status}" if retries > MAX_RETRIES

        sleep_seconds = backoff_with_jitter(retries)
        Rails.logger.warn "[RiotClient] 5xx, retry #{retries}/#{MAX_RETRIES} in #{sleep_seconds}s"
        sleep(sleep_seconds)
      else
        return response
      end
    end
  end

  def backoff_with_jitter(retries)
    base = 2**retries
    jitter = rand(0.0..1.0)
    [ [ base + jitter, 10.0 ].min, 0.1 ].max
  end
end
