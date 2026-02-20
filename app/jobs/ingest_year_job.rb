# frozen_string_literal: true

class IngestYearJob < ApplicationJob
  queue_as :default

  # Delay between match-detail API calls. Riot: 100 req/120s sustained.
  # 1.2s ≈ 100 fetches in 2 min. Set RIOT_MATCH_DELAY in ENV to override.
  MATCH_FETCH_DELAY_SECONDS = (ENV["RIOT_MATCH_DELAY"] || 1.2).to_f

  def perform(player_id, year)
    player = Player.find_by(id: player_id)
    return unless player

    lock = IngestLock.new
    return if lock.locked?(player_id) # Another job won the race
    lock.acquire!(player_id)

    start_time = Time.utc(year, 1, 1)
    end_time = Time.utc(year + 1, 1, 1)
    region = player.region
    puuid = player.puuid
    riot_client = RiotClient.new

    start_idx = 0
    count = 100
    stop_ingestion = false
    match_uids_for_year = []

    while stop_ingestion == false
      match_ids = riot_client.fetch_match_ids_by_puuid(
        puuid: puuid,
        region: region,
        start: start_idx,
        count: count
      )

      break if match_ids.blank?

      # Batch lookup: one query instead of N to find which matches we already have
      existing_by_uid = Match.where(match_uid: match_ids).index_by(&:match_uid)

      match_ids.each do |match_uid|
        existing = existing_by_uid[match_uid]
        if existing
          game_start = existing.game_start_at
        else
          match_data = riot_client.fetch_match(match_uid: match_uid, region: region)
          sleep(MATCH_FETCH_DELAY_SECONDS)
          game_start_ms = match_data.dig(:info, :gameStartTimestamp)
          game_start = game_start_ms ? Time.at(game_start_ms / 1000.0).utc : nil

          unless game_start
            Rails.logger.warn "[IngestYearJob] No gameStartTimestamp for match #{match_uid}"
            next
          end

          persist_match(player, match_uid, region, game_start, year, match_data)
        end

        if game_start >= end_time
          next # too new, skip
        end

        if game_start < start_time
          stop_ingestion = true
          break
        end

        # Include: start_time <= game_start < end_time
        match_uids_for_year << match_uid
      end

      start_idx += match_ids.size
      break if match_ids.size < count || stop_ingestion
    end

    player.update!(year_match_ids: (player.year_match_ids || {}).merge(year.to_s => match_uids_for_year))

    RecapPerson.where(player_id: player_id, year: year).delete_all
    ComputeMostPlayedWithJob.perform_later(player_id, year)
    Rails.logger.info "[IngestYearJob] Completed for player #{player_id} year #{year}, enqueued ComputeMostPlayedWithJob (#{match_uids_for_year.size} matches)"
  rescue RiotClient::NotFound, RiotClient::ApiError => e
    Rails.logger.error "[IngestYearJob] Failed for player #{player_id} year #{year}: #{e.message}"
    mark_recap_failed(player_id, year)
    raise
  ensure
    IngestLock.new.release!(player_id)
  end

  private

  def mark_recap_failed(player_id, year)
    player = Player.find_by(id: player_id)
    return unless player

    statuses = (player.recap_statuses || {}).merge(year.to_s => "failed")
    player.update_columns(recap_statuses: statuses)
  end

  def persist_match(_player, match_uid, region, game_start_at, year, match_data)
    return if Match.exists?(match_uid: match_uid)

    Match.create!(
      match_uid: match_uid,
      region: region,
      game_start_at: game_start_at,
      year: year,
      raw_json: match_data
    )
  end
end
