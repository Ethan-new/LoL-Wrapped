# frozen_string_literal: true

class ComputeMostPlayedWithJob < ApplicationJob
  queue_as :compute

  # Exclude trinket/ward items and biscuits from top items built
  EXCLUDED_ITEM_IDS = [ 3340, 3363, 3364, 3341, 3342, 2055, 2010 ].freeze # Stealth Ward, Farsight Alteration, Oracle Alteration, Scrying Orb, Sweeping Lens, Total Biscuit of Everlasting Will

  # Late-scaling champions (championId) - commonly identified as late-game scalers
  LATE_SCALING_CHAMPION_IDS = [ 10, 38, 45, 75, 8, 14, 516, 203, 412, 24, 13, 268, 136, 96, 29, 67, 34, 69, 31 ].freeze # Kayle, Kassadin, Veigar, Nasus, Vladimir, Sion, Ornn, Kindred, Thresh, Jax, Ryze, Azir, AurelionSol, KogMaw, Twitch, Vayne, Anivia, Cassiopeia, ChoGath

  # Riot API: timeCCingOthers, totalTimeCCDealt at participant root; rest in challenges
  EXTRA_STAT_KEYS = %w[
    skillshotsHit skillshotsDodged outnumberedKills soloKills
    saveAllyFromDeath timeCCingOthers totalTimeCCDealt
    scuttleCrabKills buffsStolen
  ].freeze

  # queueId -> category for "most popular queue type" card
  QUEUE_TO_CATEGORY = {
    420 => "ranked_solo",
    440 => "ranked_flex",
    400 => "normal_draft",
    430 => "blind_pick",
    450 => "aram",
    700 => "clash",
    720 => "clash",
    0 => "custom"
  }.freeze
  URF_RGM_QUEUE_IDS = [ 76, 78, 900, 1010, 1900, 1400, 1300, 1020, 325, 910, 920, 940, 980, 990, 1000, 1700, 1710 ].freeze

  def perform(player_id, year)
    player = Player.find_by(id: player_id)
    unless player
      Rails.logger.warn "[ComputeMostPlayedWithJob] Player #{player_id} not found"
      return
    end

    IngestProgress.new.set_progress(player_id, year, phase: "computing")

    match_uids = (player.year_match_ids || {}).dig(year.to_s) || []
    if match_uids.empty?
      Rails.logger.warn "[ComputeMostPlayedWithJob] No match_uids for player #{player_id} year #{year}"
    end

    aggregates = Hash.new { |h, k| h[k] = { games: 0, wins_together: 0, kills_and_assists: 0, team_kills: 0 } }
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
    total_last_hits = 0
    sum_cs_per_min = 0.0
    games_for_cs = 0
    # Playstyle Identity
    games_count = 0
    max_team_damage_pct = 0.0
    games_most_damage = 0
    sum_gold_per_min = 0.0
    games_top_gold = 0
    sum_deaths = 0
    games_zero_deaths = 0
    sum_time_spent_dead = 0.0
    sum_takedowns_first_x = 0.0
    sum_lane_minions_first_10 = 0.0
    games_first_blood = 0
    games_with_early_stats = 0
    games_with_lane_minions = 0
    # Clutch & Chaos
    total_survived_single_digit_hp = 0
    total_objectives_stolen = 0
    total_dragons_taken = 0
    total_barons_taken = 0
    total_turrets_taken = 0
    games_ended_surrender = 0
    wins_in_surrender_games = 0
    # Economy & Scaling
    sum_game_duration_sec = 0
    wins_by_bucket = { under20: 0, w20_30: 0, over30: 0 }
    games_by_bucket = { under20: 0, w20_30: 0, over30: 0 }
    wins_negative_gpm_vs_opponent = 0
    wins_after_early_gold_deficit = 0
    games_on_scaling_champs = 0
    # Champion Personality
    champion_stats = Hash.new { |h, k| h[k] = { games: 0, wins: 0, kills: 0, deaths: 0, assists: 0 } }
    # Vision & Map IQ
    sum_vision_score_per_min = 0.0
    games_with_vision = 0
    total_control_wards_placed = 0
    total_ward_takedowns = 0
    sum_vision_score_advantage = 0.0
    games_with_vision_advantage = 0
    # Damage Profile
    total_physical_damage = 0
    total_magic_damage = 0
    total_true_damage = 0
    sum_damage_taken_pct = 0.0
    games_with_damage_taken_pct = 0
    total_damage_self_mitigated = 0
    max_damage_per_min = 0.0
    sum_damage_per_min = 0.0
    total_turret_plates_taken = 0
    total_team_kills_all_games = 0
    queue_counts = Hash.new(0)
    time_by_queue = Hash.new(0)
    best_game = nil
    best_game_score = -1.0
    worst_game = nil
    worst_game_score = -1.0
    match_results_for_streaks = []
    time_heatmap = Hash.new(0)

    matches_by_uid = Match.where(match_uid: match_uids).index_by(&:match_uid)
    match_uids.each do |match_uid|
      match = matches_by_uid[match_uid]
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
      queue_id = (info["queueId"] || info[:queueId]).to_i
      category = QUEUE_TO_CATEGORY[queue_id] || (URF_RGM_QUEUE_IDS.include?(queue_id) ? "urf_rgm" : "other")
      queue_counts[category] += 1

      game_sec = info["gameDuration"] || info[:gameDuration]
      game_sec = (info["gameDurationMillis"] || info[:gameDurationMillis]).to_i / 1000 if game_sec.blank?
      game_sec_i = game_sec.to_i
      total_game_seconds += game_sec_i
      time_by_queue[category] += game_sec_i

      p = player_entry[:participant]
      team_id = (p["teamId"] || p[:teamId]).to_s
      player_won = p["win"] || p[:win] || false

      game_start = match.game_start_at
      match_results_for_streaks << { ts: game_start, won: player_won } if game_start.present?
      if game_start.present?
        wday = game_start.wday
        hour = game_start.hour
        time_heatmap["#{wday}_#{hour}"] += 1
      end

      # KDA
      total_kills += (p["kills"] || p[:kills]).to_i
      total_deaths += (p["deaths"] || p[:deaths]).to_i
      total_assists += (p["assists"] || p[:assists]).to_i

      # Last hits (lane + jungle minions)
      total_minions = (p["totalMinionsKilled"] || p[:totalMinionsKilled] || 0).to_i
      total_neutral = (p["neutralMinionsKilled"] || p[:neutralMinionsKilled] || 0).to_i
      game_last_hits = total_minions + total_neutral
      total_last_hits += game_last_hits

      # CS per minute and gold per min (per game, then we average)
      duration_mins = game_sec.to_f / 60.0
      if duration_mins > 0
        sum_cs_per_min += game_last_hits / duration_mins
        games_for_cs += 1
      end

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

      # Playstyle Identity per-game
      games_count += 1
      my_damage = (p["totalDamageDealtToChampions"] || p[:totalDamageDealtToChampions] || 0).to_f
      team_damage = (my_damage + teammates.sum { |r| (r[:participant]["totalDamageDealtToChampions"] || r[:participant][:totalDamageDealtToChampions] || 0).to_f })
      if team_damage > 0
        my_pct = (my_damage / team_damage) * 100.0
        max_team_damage_pct = [ max_team_damage_pct, my_pct ].max
        games_most_damage += 1 if teammates.none? { |r| (r[:participant]["totalDamageDealtToChampions"] || r[:participant][:totalDamageDealtToChampions] || 0).to_f >= my_damage }
      end

      gold_earned = (p["goldEarned"] || p[:goldEarned] || p["goldSpent"] || p[:goldSpent] || 0).to_i
      if duration_mins > 0
        gpm = gold_earned / duration_mins
        sum_gold_per_min += gpm
        games_top_gold += 1 if teammates.none? { |r| (r[:participant]["goldEarned"] || r[:participant][:goldEarned] || r[:participant]["goldSpent"] || r[:participant][:goldSpent] || 0).to_i >= gold_earned }
      end

      deaths = (p["deaths"] || p[:deaths] || 0).to_i
      sum_deaths += deaths
      games_zero_deaths += 1 if deaths == 0
      chal = p["challenges"] || p[:challenges] || {}
      time_spent_dead_val = p["timeSpentDead"] || p[:timeSpentDead] || chal["timeSpentDead"] || chal[:timeSpentDead]
      time_spent_dead_sec = time_spent_dead_val.to_f
      # Riot match-v5 may not return timeSpentDead; estimate ~25s per death when missing
      time_spent_dead_sec = deaths * 25.0 if time_spent_dead_sec <= 0 && deaths.positive?
      sum_time_spent_dead += time_spent_dead_sec

      takedowns_first = chal["takedownsFirst25Minutes"] || chal[:takedownsFirst25Minutes] || chal["takedownsFirst10Minutes"] || chal[:takedownsFirst10Minutes]
      lane_minions_10 = chal["laneMinionsFirst10Minutes"] || chal[:laneMinionsFirst10Minutes]
      if takedowns_first.present?
        sum_takedowns_first_x += takedowns_first.to_f
        games_with_early_stats += 1
      end
      if lane_minions_10.present?
        sum_lane_minions_first_10 += lane_minions_10.to_f
        games_with_lane_minions += 1
      end
      games_first_blood += 1 if (p["firstBloodKill"] || p[:firstBloodKill]).to_s == "true" || (p["firstBloodAssist"] || p[:firstBloodAssist]).to_s == "true"

      # Clutch & Chaos: from challenges
      total_survived_single_digit_hp += (chal["survivedSingleDigitHpCount"] || chal[:survivedSingleDigitHpCount] || 0).to_i
      obj_stolen = (chal["objectivesStolen"] || chal[:objectivesStolen] || 0).to_i
      obj_stolen_assist = (chal["objectivesStolenAssists"] || chal[:objectivesStolenAssists] || 0).to_i
      total_objectives_stolen += obj_stolen + obj_stolen_assist

      # Surrender: info.teams[].endOfGameResult often contains "Surrender" or "EarlySurrender"
      teams_for_surrender = info["teams"] || info[:teams] || []
      surrender_result = teams_for_surrender.any? do |t|
        result = (t["endOfGameResult"] || t[:endOfGameResult]).to_s
        result.include?("Surrender") || result.include?("EarlySurrender")
      end
      if surrender_result
        games_ended_surrender += 1
        wins_in_surrender_games += 1 if player_won
      end

      # Economy & Scaling
      sum_game_duration_sec += game_sec.to_i
      bucket = if duration_mins < 20
        :under20
      elsif duration_mins <= 30
        :w20_30
      else
        :over30
      end
      games_by_bucket[bucket] += 1
      wins_by_bucket[bucket] += 1 if player_won

      opponents = resolved.select { |r| (r[:participant]["teamId"] || r[:participant][:teamId]).to_s != team_id }
      enemy_total_gold = opponents.sum { |r| (r[:participant]["goldEarned"] || r[:participant][:goldEarned] || r[:participant]["goldSpent"] || r[:participant][:goldSpent] || 0).to_i }
      if duration_mins > 0 && player_won
        our_gpm = gold_earned / duration_mins
        enemy_gpm = enemy_total_gold.to_f / (5.0 * duration_mins) # 5 enemies, per-player avg
        wins_negative_gpm_vs_opponent += 1 if our_gpm < enemy_gpm
      end
      gold_diff_15 = chal["goldDiffAt15"] || chal[:goldDiffAt15]
      wins_after_early_gold_deficit += 1 if player_won && gold_diff_15.present? && gold_diff_15.to_f < 0

      champion_id = (p["championId"] || p[:championId] || 0).to_i
      champion_stats[champion_id][:games] += 1
      champion_stats[champion_id][:wins] += 1 if player_won
      champion_stats[champion_id][:kills] += (p["kills"] || p[:kills]).to_i
      champion_stats[champion_id][:deaths] += (p["deaths"] || p[:deaths]).to_i
      champion_stats[champion_id][:assists] += (p["assists"] || p[:assists]).to_i
      games_on_scaling_champs += 1 if champion_id.positive? && LATE_SCALING_CHAMPION_IDS.include?(champion_id)

      # Vision & Map IQ
      vision_score = (p["visionScore"] || p[:visionScore] || chal["visionScore"] || chal[:visionScore] || 0).to_f
      if duration_mins > 0 && vision_score >= 0
        sum_vision_score_per_min += vision_score / duration_mins
        games_with_vision += 1
      end
      control_wards = (p["controlWardsPlaced"] || p[:controlWardsPlaced] || chal["controlWardsPlaced"] || chal[:controlWardsPlaced]).to_i
      control_wards = (p["visionWardsBoughtInGame"] || p[:visionWardsBoughtInGame]).to_i if control_wards.zero? # fallback: control wards bought
      total_control_wards_placed += control_wards
      total_ward_takedowns += (p["wardsKilled"] || p[:wardsKilled] || chal["wardTakedowns"] || chal[:wardTakedowns] || 0).to_i
      total_turret_plates_taken += (chal["turretPlatesTaken"] || chal[:turretPlatesTaken] || 0).to_i
      total_turrets_taken += (p["turretKills"] || p[:turretKills] || chal["turretTakedowns"] || chal[:turretTakedowns] || 0).to_i
      total_dragons_taken += (p["dragonKills"] || p[:dragonKills] || chal["dragonKills"] || chal[:dragonKills] || 0).to_i
      total_barons_taken += (p["baronKills"] || p[:baronKills] || chal["baronKills"] || chal[:baronKills] || 0).to_i
      vs_adv = chal["visionScoreAdvantageLaneOpponent"] || chal[:visionScoreAdvantageLaneOpponent]
      if vs_adv.present?
        sum_vision_score_advantage += vs_adv.to_f
        games_with_vision_advantage += 1
      end

      # Damage Profile
      phys = (p["physicalDamageDealtToChampions"] || p[:physicalDamageDealtToChampions] || 0).to_f
      magic = (p["magicDamageDealtToChampions"] || p[:magicDamageDealtToChampions] || 0).to_f
      true_dmg = (p["trueDamageDealtToChampions"] || p[:trueDamageDealtToChampions] || 0).to_f
      total_physical_damage += phys
      total_magic_damage += magic
      total_true_damage += true_dmg
      dmg_taken_pct = chal["damageTakenOnTeamPercentage"] || chal[:damageTakenOnTeamPercentage]
      if dmg_taken_pct.present?
        sum_damage_taken_pct += dmg_taken_pct.to_f
        games_with_damage_taken_pct += 1
      end
      total_damage_self_mitigated += (p["damageSelfMitigated"] || p[:damageSelfMitigated] || chal["damageSelfMitigated"] || chal[:damageSelfMitigated] || 0).to_f
      if duration_mins > 0 && my_damage > 0
        dpm = my_damage / duration_mins
        max_damage_per_min = [ max_damage_per_min, dpm ].max
        sum_damage_per_min += dpm
      end

      our_kills = (p["kills"] || p[:kills]).to_i
      our_assists = (p["assists"] || p[:assists]).to_i
      our_ka = our_kills + our_assists
      team_kills = our_kills + teammates.sum { |r| (r[:participant]["kills"] || r[:participant][:kills]).to_i }
      total_team_kills_all_games += team_kills

      # Best game (Match MVP): composite score favoring KDA, damage, win
      deaths_val = (p["deaths"] || p[:deaths]).to_i
      kda_mult = deaths_val.positive? ? (our_kills + our_assists).to_f / deaths_val : (our_kills + our_assists).to_f
      mvp_score = kda_mult * 3 + my_damage / 3000.0 + (player_won ? 15 : 0)
      if mvp_score > best_game_score
        best_game_score = mvp_score
        best_game = {
          "kills" => our_kills,
          "deaths" => deaths_val,
          "assists" => our_assists,
          "damage" => my_damage.round,
          "durationSeconds" => game_sec_i,
          "championId" => (p["championId"] || p[:championId]).to_i
        }
      end

      # Worst game (funny slide): favor high deaths, low K+A, losses
      worst_score = deaths_val * 3 - our_kills - our_assists + (player_won ? 0 : 15)
      if worst_score > worst_game_score
        worst_game_score = worst_score
        worst_game = {
          "kills" => our_kills,
          "deaths" => deaths_val,
          "assists" => our_assists,
          "championId" => (p["championId"] || p[:championId]).to_i
        }
      end
      teammates.each do |r|
        t_puuid = r[:puuid]
        next if t_puuid.blank?

        aggregates[t_puuid][:games] += 1
        aggregates[t_puuid][:wins_together] += 1 if player_won
        aggregates[t_puuid][:kills_and_assists] += our_ka
        aggregates[t_puuid][:team_kills] += team_kills
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

    extra_stats["totalLastHits"] = total_last_hits
    extra_stats["avgCsPerMin"] = games_for_cs.positive? ? (sum_cs_per_min / games_for_cs).round(1) : nil

    # Playstyle Identity
    extra_stats["playstyleIdentity"] = {
      "mainCharacterEnergy" => {
        "highestTeamDamagePercentage" => games_count.positive? ? max_team_damage_pct.round(1) : nil,
        "gamesMostDamageOnTeam" => games_count.positive? ? games_most_damage : nil,
        "gamesCount" => games_count,
        "gamesMostDamagePercent" => games_count.positive? ? (100.0 * games_most_damage / games_count).round(1) : nil
      },
      "goldGoblinIndex" => {
        "avgGoldPerMin" => (sum_gold_per_min.positive? && games_count.positive?) ? (sum_gold_per_min / games_count).round(0) : nil,
        "gamesTopGoldOnTeam" => games_count.positive? ? games_top_gold : nil,
        "gamesTopGoldPercent" => games_count.positive? ? (100.0 * games_top_gold / games_count).round(1) : nil
      },
      "riskToleranceScore" => {
        "avgDeaths" => games_count.positive? ? (sum_deaths.to_f / games_count).round(1) : nil,
        "gamesWithZeroDeaths" => games_zero_deaths,
        "avgTimeSpentDead" => games_count.positive? ? (sum_time_spent_dead / games_count).round(0) : nil
      },
      "earlyGameDemon" => {
        "avgTakedownsFirstXMinutes" => games_with_early_stats.positive? ? (sum_takedowns_first_x / games_with_early_stats).round(1) : nil,
        "avgLaneMinionsFirst10Minutes" => games_with_lane_minions.positive? ? (sum_lane_minions_first_10 / games_with_lane_minions).round(1) : nil,
        "gamesFirstBloodInvolvement" => games_first_blood,
        "firstBloodInvolvementPercent" => games_count.positive? ? (100.0 * games_first_blood / games_count).round(1) : nil
      }
    }

    # Clutch & Chaos Moments
    outnumbered_kills_total = (extra_stats["outnumberedKills"] || extra_stats[:outnumberedKills] || 0).to_i
    extra_stats["clutchChaosMoments"] = {
      "oneHpSurvivor" => {
        "survivedSingleDigitHpCount" => total_survived_single_digit_hp
      },
      "outnumberedFighter" => {
        "outnumberedKills" => outnumbered_kills_total
      },
      "objectiveThiefPotential" => {
        "objectivesStolenPlusAssists" => total_objectives_stolen
      },
      "firstBloodMagnet" => {
        "gamesFirstBloodInvolvement" => games_first_blood,
        "firstBloodInvolvementPercent" => games_count.positive? ? (100.0 * games_first_blood / games_count).round(1) : nil
      },
      "surrenderStats" => {
        "gamesEndedInSurrender" => games_ended_surrender,
        "surrenderGamesPercent" => games_count.positive? ? (100.0 * games_ended_surrender / games_count).round(1) : nil,
        "winsInSurrenderGames" => wins_in_surrender_games,
        "winrateInSurrenderGames" => games_ended_surrender.positive? ? (100.0 * wins_in_surrender_games / games_ended_surrender).round(1) : nil
      }
    }

    # Economy & Scaling
    winrate_by_bucket = {}
    games_by_bucket.each do |k, g|
      winrate_by_bucket[k.to_s] = g.positive? ? (100.0 * wins_by_bucket[k] / g).round(1) : nil
    end
    extra_stats["economyScaling"] = {
      "avgGameDurationSeconds" => games_count.positive? ? (sum_game_duration_sec / games_count).round(0) : nil,
      "winrateByBucket" => winrate_by_bucket,
      "gamesByBucket" => games_by_bucket.transform_values { |v| v },
      "comebackMerchant" => {
        "winsWithNegativeGpmVsOpponent" => wins_negative_gpm_vs_opponent,
        "winsAfterEarlyGoldDeficit" => wins_after_early_gold_deficit
      },
      "scalingPickAddict" => {
        "gamesOnScalingChamps" => games_on_scaling_champs,
        "scalingChampsPercent" => games_count.positive? ? (100.0 * games_on_scaling_champs / games_count).round(1) : nil
      }
    }

    # Champion Personality
    min_games_for_winrate = 5
    sorted_by_games = champion_stats.sort_by { |_cid, c| -c[:games] }
    most_played = sorted_by_games.first
    most_played_id = most_played&.first
    most_played_data = most_played&.last || { games: 0, wins: 0 }

    highest_wr = champion_stats
      .select { |_cid, c| c[:games] >= min_games_for_winrate }
      .max_by { |_cid, c| c[:games] > 0 ? (100.0 * c[:wins] / c[:games]) : 0 }

    why_pick = champion_stats
      .select { |_cid, c| c[:games] >= 3 && c[:wins].to_f / c[:games] < 0.5 }
      .max_by { |_cid, c| c[:games] }

    most_played_kda = most_played_data[:games].positive? ? { "kills" => most_played_data[:kills], "deaths" => most_played_data[:deaths], "assists" => most_played_data[:assists] } : nil
    extra_stats["championPersonality"] = {
      "mostPlayedChampion" => most_played_id.present? ? { "championId" => most_played_id, "games" => most_played_data[:games], "wins" => most_played_data[:wins], "winrate" => most_played_data[:games].positive? ? (100.0 * most_played_data[:wins] / most_played_data[:games]).round(1) : nil, "kda" => most_played_kda } : nil,
      "highestWinrateChampion" => highest_wr ? { "championId" => highest_wr[0], "games" => highest_wr[1][:games], "wins" => highest_wr[1][:wins], "winrate" => (100.0 * highest_wr[1][:wins] / highest_wr[1][:games]).round(1) } : nil,
      "whyDoYouKeepPickingThis" => why_pick ? { "championId" => why_pick[0], "games" => why_pick[1][:games], "wins" => why_pick[1][:wins], "winrate" => (100.0 * why_pick[1][:wins] / why_pick[1][:games]).round(1) } : nil,
      "oneTrickScore" => (games_count.positive? && most_played_data[:games].positive?) ? (100.0 * most_played_data[:games] / games_count).round(1) : nil
    }
    extra_stats["gamesCount"] = games_count
    extra_stats["uniqueChampionsPlayed"] = champion_stats.size
    top_champions = sorted_by_games.first(6).map do |cid, c|
      wr = c[:games].positive? ? (100.0 * c[:wins] / c[:games]).round(1) : nil
      { "championId" => cid, "games" => c[:games], "wins" => c[:wins], "winrate" => wr }
    end
    extra_stats["topChampions"] = top_champions if top_champions.any?
    extra_stats["bestGame"] = best_game if best_game.present?
    extra_stats["worstGame"] = worst_game if worst_game.present?

    # Winrate Insights: best and worst champion winrate (min 5 games)
    low_wr = champion_stats
      .select { |cid, c| c[:games] >= min_games_for_winrate && cid != highest_wr&.first }
      .min_by { |_cid, c| c[:games] > 0 ? (100.0 * c[:wins] / c[:games]) : 100 }
    extra_stats["winrateInsights"] = {
      "bestChampion" => highest_wr ? { "championId" => highest_wr[0], "games" => highest_wr[1][:games], "wins" => highest_wr[1][:wins], "winrate" => (100.0 * highest_wr[1][:wins] / highest_wr[1][:games]).round(1) } : nil,
      "worstChampion" => low_wr ? { "championId" => low_wr[0], "games" => low_wr[1][:games], "wins" => low_wr[1][:wins], "winrate" => (100.0 * low_wr[1][:wins] / low_wr[1][:games]).round(1) } : nil
    }

    # Streaks: longest win streak, longest loss streak (chronological order)
    sorted_results = match_results_for_streaks.sort_by { |r| r[:ts] }
    longest_win = 0
    longest_loss = 0
    current_win = 0
    current_loss = 0
    sorted_results.each do |r|
      if r[:won]
        current_win += 1
        current_loss = 0
        longest_win = [ longest_win, current_win ].max
      else
        current_loss += 1
        current_win = 0
        longest_loss = [ longest_loss, current_loss ].max
      end
    end
    extra_stats["streaks"] = { "longestWinStreak" => longest_win, "longestLossStreak" => longest_loss } if longest_win.positive? || longest_loss.positive?

    # Time Played: heatmap day x hour
    extra_stats["timePlayedHeatmap"] = time_heatmap if time_heatmap.any?

    # Vision & Map IQ
    enemy_missing_pings = (ping_breakdown["enemyMissingPings"] || ping_breakdown[:enemyMissingPings] || 0).to_i
    extra_stats["visionMapIq"] = {
      "visionScorePerMinAvg" => games_with_vision.positive? ? (sum_vision_score_per_min / games_with_vision).round(2) : nil,
      "controlWardsPlacedPerGame" => games_count.positive? ? (total_control_wards_placed.to_f / games_count).round(1) : nil,
      "wardTakedownsPerGame" => games_count.positive? ? (total_ward_takedowns.to_f / games_count).round(1) : nil,
      "mapAwarenessScore" => {
        "enemyMissingPingsUsed" => enemy_missing_pings,
        "visionScoreAdvantageLaneOpponentAvg" => games_with_vision_advantage.positive? ? (sum_vision_score_advantage / games_with_vision_advantage).round(1) : nil
      }
    }

    # Damage Profile
    total_dmg_dealt = total_physical_damage + total_magic_damage + total_true_damage
    damage_split = if total_dmg_dealt.positive?
      {
        "physicalPercent" => (100.0 * total_physical_damage / total_dmg_dealt).round(1),
        "magicPercent" => (100.0 * total_magic_damage / total_dmg_dealt).round(1),
        "truePercent" => (100.0 * total_true_damage / total_dmg_dealt).round(1)
      }
    else
      { "physicalPercent" => nil, "magicPercent" => nil, "truePercent" => nil }
    end
    extra_stats["damageProfile"] = {
      "damageSplitPersonality" => damage_split,
      "tankVsGlassCannon" => {
        "damageTakenOnTeamPercentageAvg" => games_with_damage_taken_pct.positive? ? (sum_damage_taken_pct / games_with_damage_taken_pct).round(1) : nil,
        "damageSelfMitigatedTotal" => total_damage_self_mitigated.positive? ? total_damage_self_mitigated.round(0) : nil
      },
      "dpsMonster" => {
        "damagePerMinutePeak" => max_damage_per_min.positive? ? max_damage_per_min.round(0) : nil,
        "damagePerMinuteAvg" => games_count.positive? && sum_damage_per_min.positive? ? (sum_damage_per_min / games_count).round(0) : nil
      }
    }

    # Bot Lane Synergy (top 5 duos with KP, winrate, pct of games)
    resolver = PlayerResolver.new
    region = player.region.presence || "americas"
    top_duos = aggregates
      .sort_by { |_puuid, c| [ -c[:games], -c[:wins_together] ] }
      .first(5)
    top_teammates = aggregates
      .select { |_puuid, c| c[:games] > 1 }
      .sort_by { |_puuid, c| [ -c[:games], -c[:wins_together] ] }
      .first(10)
    top_enemies = enemy_aggregates
      .select { |_puuid, count| count > 1 }
      .sort_by { |_puuid, count| -count }
      .first(10)
    puuids_to_resolve = (top_duos.map(&:first) + top_teammates.map(&:first) + top_enemies.map(&:first)).uniq
    riot_ids_by_puuid = puuids_to_resolve.to_h { |puuid| [ puuid, resolver.resolve(puuid: puuid, region: region) ] }

    duo_records = top_duos.map do |teammate_puuid, c|
      kp = c[:team_kills].positive? ? (100.0 * c[:kills_and_assists] / c[:team_kills]).round(1) : nil
      {
        "teammatePuuid" => teammate_puuid,
        "teammateRiotId" => riot_ids_by_puuid[teammate_puuid],
        "games" => c[:games],
        "wins" => c[:wins_together],
        "winrate" => c[:games].positive? ? (100.0 * c[:wins_together] / c[:games]).round(1) : nil,
        "killParticipation" => kp,
        "pctOfTotalGames" => (games_count.positive? && c[:games].positive?) ? (100.0 * c[:games] / games_count).round(1) : nil
      }
    end
    ride_or_die = duo_records.first
    extra_stats["botLaneSynergy"] = {
      "topDuos" => duo_records,
      "rideOrDie" => ride_or_die
    }

    # Most popular queue type (category + games)
    top_category = queue_counts.reject { |k, _| k == "other" }.max_by { |_, v| v }
    if top_category
      extra_stats["mostPopularQueueType"] = {
        "type" => top_category[0],
        "games" => top_category[1]
      }
    end

    # Queue distribution for pie chart (category -> games, exclude zero)
    dist = queue_counts.reject { |_, v| v.to_i <= 0 }
    extra_stats["queueDistribution"] = dist if dist.any?

    # Time in game per queue (category -> seconds, exclude zero)
    time_dist = time_by_queue.reject { |_, v| v.to_i <= 0 }
    extra_stats["timeByQueue"] = time_dist if time_dist.any?

    # Meme Titles (earned based on stat thresholds)
    surrender_pct = games_count.positive? ? (100.0 * games_ended_surrender / games_count) : 0
    vision_per_min = games_with_vision.positive? ? (sum_vision_score_per_min / games_with_vision) : 0
    kp_overall = total_team_kills_all_games.positive? ? (100.0 * (total_kills + total_assists) / total_team_kills_all_games) : 100
    meme_titles = []
    meme_titles << "Plate Thief" if total_turret_plates_taken >= 50
    meme_titles << "Early FF Enjoyer" if surrender_pct >= 30
    meme_titles << "Solo Queue Therapist" if total_assists > total_kills * 2 && total_assists > 500
    meme_titles << "Main Character Syndrome" if max_team_damage_pct >= 35 && kp_overall < 50
    meme_titles << "Vision Ward Addict" if vision_per_min >= 2.0
    extra_stats["memeTitles"] = meme_titles

    # MVP Insight: pick ONE archetype (Playmaker, Carry, Farmer, Specialist, Objective Player, Teamfighter, Aggressive, Consistent)
    total_wins = champion_stats.values.sum { |c| c[:wins] }
    winrate = games_count.positive? ? (100.0 * total_wins / games_count) : 0
    kp = total_team_kills_all_games.positive? ? (100.0 * (total_kills + total_assists) / total_team_kills_all_games) : 0
    pi = extra_stats["playstyleIdentity"] || {}
    mce = pi["mainCharacterEnergy"] || {}
    ggi = pi["goldGoblinIndex"] || {}
    rts = pi["riskToleranceScore"] || {}
    egd = pi["earlyGameDemon"] || {}
    cc = extra_stats["clutchChaosMoments"] || {}
    obj_thief = (cc.dig("objectiveThiefPotential", "objectivesStolenPlusAssists") || 0).to_i
    fb_pct = (cc.dig("firstBloodMagnet", "firstBloodInvolvementPercent") || 0).to_f
    cp = extra_stats["championPersonality"] || {}
    one_trick = (cp["oneTrickScore"] || 0).to_f
    vm = extra_stats["visionMapIq"] || {}
    vision_per_min = (vm["visionScorePerMinAvg"] || 0).to_f
    control_wards_pg = games_count.positive? ? (total_control_wards_placed.to_f / games_count) : 0
    avg_cs = (extra_stats["avgCsPerMin"] || 0).to_f
    avg_deaths = (rts["avgDeaths"] || 0).to_f
    games_most_dmg_pct = (mce["gamesMostDamagePercent"] || 0).to_f
    highest_dmg_pct = (mce["highestTeamDamagePercentage"] || 0).to_f
    gold_top_pct = (ggi["gamesTopGoldPercent"] || 0).to_f
    plates_pg = games_count.positive? ? (total_turret_plates_taken.to_f / games_count) : 0
    avg_takedowns_early = games_with_early_stats.positive? ? (sum_takedowns_first_x / games_with_early_stats) : 0
    scuttle = (extra_stats["scuttleCrabKills"] || 0).to_f
    buffs = (extra_stats["buffsStolen"] || 0).to_f
    save_ally = (extra_stats["saveAllyFromDeath"] || 0).to_f
    assists_pg = games_count.positive? ? (total_assists.to_f / games_count) : 0
    kills_pg = games_count.positive? ? (total_kills.to_f / games_count) : 0
    ratio_a_to_k = kills_pg.positive? ? (total_assists.to_f / total_kills) : 0
    unique_champs = champion_stats.size

    mvp_scores = {
      "Playmaker" => (ratio_a_to_k >= 1.5 ? 30 : ratio_a_to_k * 15) + [ kp / 2, 30 ].min + [ save_ally * 3, 20 ].min,
      "Carry" => games_most_dmg_pct * 1.2 + highest_dmg_pct * 0.5,
      "Farmer" => [ avg_cs * 6, 50 ].min + gold_top_pct * 0.4 + plates_pg * 4,
      "Specialist" => one_trick * 0.7 + [ 50 - unique_champs, 0 ].max * 0.3,
      "Objective Player" => (games_count.positive? ? (total_dragons_taken.to_f / games_count * 8 + total_barons_taken.to_f / games_count * 25 + total_turrets_taken.to_f / games_count * 5) : 0) + control_wards_pg * 1.5 + vision_per_min * 3,
      "Teamfighter" => (games_most_dmg_pct * 0.5 + kp * 0.4) + [ assists_pg * 2, 25 ].min,
      "Aggressive" => fb_pct * 1.2 + avg_takedowns_early * 6,
      "Consistent" => (winrate >= 48 && winrate <= 55 ? 25 : 0) + (avg_deaths >= 3 && avg_deaths <= 7 ? 20 : 0) + (fb_pct < 20 ? 15 : 0)
    }
    top_archetype = mvp_scores.max_by { |_, v| v }
    if top_archetype && top_archetype[1] >= 15
      archetype_name = top_archetype[0]
      mvp_stats = case archetype_name
      when "Playmaker"
        s = []
        s << { "label" => "Kill participation", "value" => "#{kp.round(1)}%" } if kp > 0
        s << { "label" => "Assists per kill", "value" => ratio_a_to_k.round(1).to_s } if kills_pg.positive?
        s << { "label" => "Allies saved from death", "value" => save_ally.to_i.to_s } if save_ally > 0
        s
      when "Carry"
        [
          (games_most_dmg_pct > 0 ? { "label" => "Games most damage on team", "value" => "#{games_most_dmg_pct.round(1)}%" } : nil),
          (highest_dmg_pct > 0 ? { "label" => "Peak team damage share", "value" => "#{highest_dmg_pct.round(1)}%" } : nil)
        ].compact
      when "Farmer"
        s = []
        s << { "label" => "CS per minute", "value" => avg_cs.round(1).to_s } if avg_cs > 0
        s << { "label" => "Games top gold on team", "value" => "#{gold_top_pct.round(1)}%" } if gold_top_pct > 0
        s << { "label" => "Turret plates per game", "value" => plates_pg.round(1).to_s } if plates_pg > 0
        s
      when "Specialist"
        s = []
        s << { "label" => "Most played champ share", "value" => "#{one_trick.round(1)}%" } if one_trick > 0
        s << { "label" => "Champions played", "value" => unique_champs.to_s } if unique_champs > 0
        s
      when "Objective Player"
        [
          { "label" => "Dragons taken", "value" => total_dragons_taken.to_s },
          { "label" => "Barons taken", "value" => total_barons_taken.to_s },
          { "label" => "Turrets taken", "value" => total_turrets_taken.to_s }
        ]
      when "Teamfighter"
        s = []
        s << { "label" => "Kill participation", "value" => "#{kp.round(1)}%" } if kp > 0
        s << { "label" => "Assists per game", "value" => assists_pg.round(1).to_s } if assists_pg > 0
        s << { "label" => "Games most damage", "value" => "#{games_most_dmg_pct.round(1)}%" } if games_most_dmg_pct > 0
        s
      when "Aggressive"
        s = []
        s << { "label" => "First blood involvement", "value" => "#{fb_pct.round(1)}%" } if fb_pct > 0
        s << { "label" => "Early takedowns (first 10 min)", "value" => avg_takedowns_early.round(1).to_s } if games_with_early_stats.positive?
        s
      when "Consistent"
        s = []
        s << { "label" => "Win rate", "value" => "#{winrate.round(1)}%" } if games_count.positive?
        s << { "label" => "Deaths per game", "value" => avg_deaths.round(1).to_s } if avg_deaths > 0
        s << { "label" => "First blood rate", "value" => "#{fb_pct.round(1)}%" } if fb_pct >= 0
        s
      else
        []
      end
      extra_stats["mvpInsight"] = { "archetype" => archetype_name, "stats" => mvp_stats }
    end

    most_played_with = top_teammates.map do |teammate_puuid, counts|
      riot_id = riot_ids_by_puuid[teammate_puuid]
      {
        "teammate_puuid" => teammate_puuid,
        "teammate_riot_id" => riot_id,
        "teammate_name" => teammate_display_name(riot_id, teammate_puuid),
        "games" => counts[:games],
        "wins_together" => counts[:wins_together]
      }
    end

    most_beat_us = top_enemies.map do |enemy_puuid, times_beat_us|
      riot_id = riot_ids_by_puuid[enemy_puuid]
      {
        "enemy_puuid" => enemy_puuid,
        "enemy_riot_id" => riot_id,
        "enemy_name" => teammate_display_name(riot_id, enemy_puuid),
        "times_beat_us" => times_beat_us
      }
    end

    fav_items = item_counts
      .reject { |item_id, _| EXCLUDED_ITEM_IDS.include?(item_id) }
      .sort_by { |_id, count| -count }
      .first(5)
      .map { |item_id, count| { item_id: item_id, count: count } }

    our_team_bans = our_team_ban_counts
      .sort_by { |_id, count| -count }
      .first(5)
      .map { |champion_id, count| { champion_id: champion_id, count: count } }
    enemy_team_bans = enemy_team_ban_counts
      .sort_by { |_id, count| -count }
      .first(5)
      .map { |champion_id, count| { champion_id: champion_id, count: count } }

    now = Time.current
    RecapYearStat.upsert_all(
      [ {
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
        most_played_with: most_played_with,
        most_beat_us: most_beat_us,
        created_at: now,
        updated_at: now
      } ],
      unique_by: %i[player_id year],
      update_only: %i[total_pings ping_breakdown total_game_seconds total_gold_spent fav_items extra_stats our_team_bans enemy_team_bans total_kills total_deaths total_assists most_played_with most_beat_us]
    )

    Rails.logger.info "[ComputeMostPlayedWithJob] Upserted RecapYearStat for player #{player_id} year #{year} (#{most_played_with.size} teammates, #{most_beat_us.size} enemies)"

    mark_recap_ready(player_id, year)
  rescue StandardError => e
    Rails.logger.error "[ComputeMostPlayedWithJob] Failed: #{e.class} #{e.message}\n#{e.backtrace.first(5).join("\n")}"
    mark_recap_failed(player_id, year, e.message)
    raise
  ensure
    IngestProgress.new.clear(player_id, year)
  end

  private

  def teammate_display_name(riot_id, puuid)
    return riot_id if riot_id.present?
    return "…#{puuid[-6..]}" if puuid.to_s.length >= 6
    "Unknown"
  end

  def mark_recap_ready(player_id, year)
    player = Player.find_by(id: player_id)
    return unless player

    statuses = (player.recap_statuses || {}).merge(year.to_s => "ready")
    player.update_columns(recap_statuses: statuses)
  end

  def mark_recap_failed(player_id, year, reason = nil)
    player = Player.find_by(id: player_id)
    return unless player

    statuses = (player.recap_statuses || {}).merge(year.to_s => "failed")
    failure_reasons = (player.recap_failure_reasons || {}).merge(year.to_s => reason.to_s.truncate(200))
    player.update_columns(recap_statuses: statuses, recap_failure_reasons: failure_reasons)
  end
end
