# frozen_string_literal: true

class ComputeMostPlayedWithJob < ApplicationJob
  queue_as :default

  # Riot API: timeCCingOthers, totalTimeCCDealt at participant root; rest in challenges
  EXTRA_STAT_KEYS = %w[
    skillshotsHit skillshotsDodged outnumberedKills soloKills
    saveAllyFromDeath timeCCingOthers totalTimeCCDealt
    scuttleCrabKills buffsStolen
  ].freeze

  def perform(player_id, year)
    player = Player.find_by(id: player_id)
    unless player
      Rails.logger.warn "[ComputeMostPlayedWithJob] Player #{player_id} not found"
      return
    end

    match_uids = (player.year_match_ids || {}).dig(year.to_s) || []
    if match_uids.empty?
      Rails.logger.warn "[ComputeMostPlayedWithJob] No match_uids for player #{player_id} year #{year}"
    end

    aggregates = Hash.new { |h, k| h[k] = { games: 0, wins_together: 0 } }
    enemy_aggregates = Hash.new(0) # puuid => times_beat_us
    total_pings = 0
    ping_breakdown = Hash.new(0)
    total_game_seconds = 0
    total_gold_spent = 0
    item_counts = Hash.new(0)
    extra_stats = Hash.new(0)
    our_team_ban_counts = Hash.new(0)
    enemy_team_ban_counts = Hash.new(0)
    total_kills = 0
    total_deaths = 0
    total_assists = 0

    match_uids.each do |match_uid|
      match = Match.find_by(match_uid: match_uid)
      unless match
        Rails.logger.warn "[ComputeMostPlayedWithJob] Match #{match_uid} not found"
        next
      end

      raw = match.raw_json || {}
      participants = raw.dig("info", "participants") || raw.dig(:info, :participants) || []
      participants = Array(participants)
      metadata_puuids = raw.dig("metadata", "participants") || raw.dig(:metadata, :participants) || []

      # Resolve puuid: in match-v5, puuid can be on participant or in metadata.participants by index
      resolved = participants.each_with_index.map do |p, i|
        puuid = p["puuid"] || p[:puuid] || metadata_puuids[i]
        { participant: p, puuid: puuid }
      end

      player_entry = resolved.find { |r| r[:puuid] == player.puuid }
      next unless player_entry

      # Match duration: gameDuration (seconds) or gameDurationMillis (ms)
      info = raw["info"] || raw[:info] || {}
      game_sec = info["gameDuration"] || info[:gameDuration]
      game_sec = (info["gameDurationMillis"] || info[:gameDurationMillis]).to_i / 1000 if game_sec.blank?
      total_game_seconds += game_sec.to_i

      p = player_entry[:participant]
      team_id = (p["teamId"] || p[:teamId]).to_s
      player_won = p["win"] || p[:win] || false

      # KDA
      total_kills += (p["kills"] || p[:kills]).to_i
      total_deaths += (p["deaths"] || p[:deaths]).to_i
      total_assists += (p["assists"] || p[:assists]).to_i

      # Gold spent
      gold = p["goldSpent"] || p[:goldSpent]
      total_gold_spent += gold.to_i

      # Item counts (item0..item6; 0 = empty slot)
      %w[item0 item1 item2 item3 item4 item5 item6].each do |slot|
        id = p[slot] || p[slot.to_sym]
        item_counts[id.to_i] += 1 if id.present? && id.to_i.positive?
      end

      # Extra stats from participant or participant.challenges
      challenges = p["challenges"] || p[:challenges] || {}
      EXTRA_STAT_KEYS.each do |key|
        val = p[key] || p[key.to_sym] || challenges[key] || challenges[key.to_sym]
        next if val.blank?
        extra_stats[key] += val.to_f
      end

      # Bans: info.teams has teamId and bans [{pickTurn, championId}]
      teams = info["teams"] || info[:teams] || []
      our_team = teams.find { |t| (t["teamId"] || t[:teamId]).to_s == team_id }
      enemy_team = teams.find { |t| (t["teamId"] || t[:teamId]).to_s != team_id }
      (our_team&.dig("bans") || our_team&.dig(:bans) || []).each do |b|
        cid = b["championId"] || b[:championId]
        our_team_ban_counts[cid.to_i] += 1 if cid.present? && cid.to_i.positive?
      end
      (enemy_team&.dig("bans") || enemy_team&.dig(:bans) || []).each do |b|
        cid = b["championId"] || b[:championId]
        enemy_team_ban_counts[cid.to_i] += 1 if cid.present? && cid.to_i.positive?
      end

      # Tally pings from participant (all keys ending with Pings)
      p.each do |key, val|
        key_s = key.to_s
        next unless key_s.end_with?("Pings") || key_s.end_with?("pings")
        next unless val.is_a?(Integer) || (val.is_a?(Numeric) && val == val.to_i)

        count = val.to_i
        total_pings += count
        ping_breakdown[key_s] += count
      end

      teammates = resolved.select do |r|
        r[:puuid].present? && r[:puuid] != player.puuid &&
          (r[:participant]["teamId"] || r[:participant][:teamId]).to_s == team_id
      end

      teammates.each do |r|
        t_puuid = r[:puuid]
        next if t_puuid.blank?

        aggregates[t_puuid][:games] += 1
        aggregates[t_puuid][:wins_together] += 1 if player_won
      end

      # Enemies: when we lost, opponents on the winning team beat us
      next unless player_won == false

      opponents = resolved.select do |r|
        r[:puuid].present? && r[:puuid] != player.puuid &&
          (r[:participant]["teamId"] || r[:participant][:teamId]).to_s != team_id
      end
      opponents.each do |r|
        e_puuid = r[:puuid]
        next if e_puuid.blank?

        enemy_aggregates[e_puuid] += 1
      end
    end

    # Sort by games desc, wins_together desc; take top 20 only
    top_20 = aggregates
      .sort_by { |_puuid, c| [-c[:games], -c[:wins_together]] }
      .first(20)

    resolver = PlayerResolver.new
    region = player.region.presence || "americas"

    now = Time.current
    records = top_20.map do |teammate_puuid, counts|
      riot_id = resolver.resolve(puuid: teammate_puuid, region: region)
      {
        player_id: player_id,
        year: year,
        teammate_puuid: teammate_puuid,
        teammate_riot_id: riot_id,
        games: counts[:games],
        wins_together: counts[:wins_together],
        created_at: now,
        updated_at: now
      }
    end

    RecapPerson.where(player_id: player_id, year: year).delete_all
    RecapEnemy.where(player_id: player_id, year: year).delete_all

    fav_items = item_counts
      .sort_by { |_id, count| -count }
      .first(3)
      .map { |item_id, count| { item_id: item_id, count: count } }

    our_team_bans = our_team_ban_counts
      .sort_by { |_id, count| -count }
      .first(5)
      .map { |champion_id, count| { champion_id: champion_id, count: count } }
    enemy_team_bans = enemy_team_ban_counts
      .sort_by { |_id, count| -count }
      .first(5)
      .map { |champion_id, count| { champion_id: champion_id, count: count } }

    RecapYearStat.upsert_all(
      [{
        player_id: player_id,
        year: year,
        total_pings: total_pings,
        ping_breakdown: ping_breakdown,
        total_game_seconds: total_game_seconds,
        total_gold_spent: total_gold_spent,
        fav_items: fav_items,
        extra_stats: extra_stats,
        our_team_bans: our_team_bans,
        enemy_team_bans: enemy_team_bans,
        total_kills: total_kills,
        total_deaths: total_deaths,
        total_assists: total_assists,
        created_at: now,
        updated_at: now
      }],
      unique_by: %i[player_id year],
      update_only: %i[total_pings ping_breakdown total_game_seconds total_gold_spent fav_items extra_stats our_team_bans enemy_team_bans total_kills total_deaths total_assists]
    )

    if records.any?
      RecapPerson.upsert_all(
        records,
        unique_by: %i[player_id year teammate_puuid],
        update_only: %i[games wins_together teammate_riot_id]
      )
      Rails.logger.info "[ComputeMostPlayedWithJob] Upserted #{records.size} recap_people (top 20) for player #{player_id} year #{year}"
    else
      Rails.logger.warn "[ComputeMostPlayedWithJob] No teammates found for player #{player_id} year #{year}"
    end

    # Top 5 enemies who beat us more than once
    top_enemies = enemy_aggregates
      .select { |_puuid, count| count > 1 }
      .sort_by { |_puuid, count| -count }
      .first(5)

    if top_enemies.any?
      enemy_records = top_enemies.map do |enemy_puuid, times_beat_us|
        riot_id = resolver.resolve(puuid: enemy_puuid, region: region)
        {
          player_id: player_id,
          year: year,
          enemy_puuid: enemy_puuid,
          enemy_riot_id: riot_id,
          times_beat_us: times_beat_us,
          created_at: now,
          updated_at: now
        }
      end
      RecapEnemy.upsert_all(
        enemy_records,
        unique_by: %i[player_id year enemy_puuid],
        update_only: %i[times_beat_us enemy_riot_id]
      )
      Rails.logger.info "[ComputeMostPlayedWithJob] Upserted #{enemy_records.size} recap_enemies for player #{player_id} year #{year}"
    end
  rescue StandardError => e
    Rails.logger.error "[ComputeMostPlayedWithJob] Failed: #{e.class} #{e.message}\n#{e.backtrace.first(5).join("\n")}"
    raise
  end
end
