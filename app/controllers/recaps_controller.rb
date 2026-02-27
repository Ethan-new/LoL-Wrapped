# frozen_string_literal: true

class RecapsController < ApplicationController
  skip_before_action :allow_browser, raise: false

  def page
    game_name, tag_line = params[:riot_id_slug].to_s.rpartition("-").then { |name, _, tag| [ name, tag ] }
    game_name = sanitize_riot_id_input(game_name)
    tag_line = sanitize_riot_id_input(tag_line)
    riot_id = "#{game_name}##{tag_line}"
    riot_region = RegionMapping.riot_region(params[:region])

    @player = Player.find_by(riot_id: riot_id, region: riot_region)
    if @player.blank?
      return redirect_to root_path, alert: "Player not found"
    end

    @year = params[:year].to_i
    previous_year = Time.current.year - 1
    if @year != previous_year
      return redirect_to player_path(region: params[:region], riot_id_slug: params[:riot_id_slug]),
                         alert: "Recap is only available for #{previous_year}."
    end

    @recap_url = player_recap_url(@player, @year)
    @player_path = player_path(region: params[:region], riot_id_slug: params[:riot_id_slug])
    render layout: "application"
  end

  def show
    player = Player.find_by(id: params[:id])
    return render json: { error: "Player not found" }, status: :not_found unless player

    year = params[:year].to_i
    previous_year = Time.current.year - 1
    if year != previous_year
      return render json: { error: "Recap is only available for #{previous_year}. Current year recaps will be available next year." }, status: :unprocessable_entity
    end

    year_stat = RecapYearStat.find_by(player_id: player.id, year: year)

    most_played_with = (year_stat&.most_played_with || []).filter_map do |r|
      next unless r.is_a?(Hash)

      r = r.with_indifferent_access if r.respond_to?(:with_indifferent_access)
      {
        teammate_puuid: r["teammate_puuid"],
        teammate_riot_id: r["teammate_riot_id"],
        teammate_name: r["teammate_name"].presence || format_teammate_name(r["teammate_riot_id"], r["teammate_puuid"]),
        games: r["games"],
        wins_together: r["wins_together"]
      }
    end

    most_beat_us = (year_stat&.most_beat_us || []).filter_map do |r|
      next unless r.is_a?(Hash)

      r = r.with_indifferent_access if r.respond_to?(:with_indifferent_access)
      {
        enemy_puuid: r["enemy_puuid"],
        enemy_riot_id: r["enemy_riot_id"],
        enemy_name: r["enemy_name"].presence || format_teammate_name(r["enemy_riot_id"], r["enemy_puuid"]),
        times_beat_us: r["times_beat_us"]
      }
    end

    fav_items = (year_stat&.fav_items || []).map do |fi|
      fi = fi.with_indifferent_access if fi.respond_to?(:with_indifferent_access)
      id = fi["item_id"] || fi[:item_id]
      next if id.blank?
      { item_id: id, count: fi["count"] || fi[:count] || 0, name: item_name(id) }
    end.compact

    extra_stats = year_stat&.extra_stats || {}
    extra_stats = enrich_extra_stats_champion_names(extra_stats)
    extra_stats = enrich_extra_stats_bot_lane(extra_stats)
    our_team_bans = format_ban_list(year_stat&.our_team_bans)
    enemy_team_bans = format_ban_list(year_stat&.enemy_team_bans)

    render json: {
      player_id: player.id,
      year: year,
      player_riot_id: player.riot_id,
      total_pings: year_stat&.total_pings || 0,
      ping_breakdown: year_stat&.ping_breakdown || {},
      total_game_seconds: year_stat&.total_game_seconds || 0,
      total_gold_spent: year_stat&.total_gold_spent || 0,
      total_kills: year_stat&.total_kills || 0,
      total_deaths: year_stat&.total_deaths || 0,
      total_assists: year_stat&.total_assists || 0,
      fav_items: fav_items,
      extra_stats: extra_stats,
      our_team_bans: our_team_bans,
      enemy_team_bans: enemy_team_bans,
      most_played_with: most_played_with,
      most_beat_us: most_beat_us
    }
  end

  ITEM_CDN_VERSION = "16.4.1"

  private

  def enrich_extra_stats_champion_names(extra_stats)
    return extra_stats if extra_stats.blank?
    champ_data = champion_data_by_id
    result = extra_stats.dup

    cp = result["championPersonality"] || result[:championPersonality]
    if cp.present?
      result["championPersonality"] = (result["championPersonality"] || {}).dup
      %w[mostPlayedChampion highestWinrateChampion whyDoYouKeepPickingThis].each do |key|
        entry = result["championPersonality"][key]
        next if entry.blank?
        entry = entry.with_indifferent_access if entry.respond_to?(:with_indifferent_access)
        cid = (entry["championId"] || entry[:championId]).to_s
        info = champ_data[cid] || {}
        result["championPersonality"][key] = entry.merge("name" => info["name"], "key" => info["key"])
      end
    end

    top = result["topChampions"] || result[:topChampions]
    if top.present?
      result["topChampions"] = Array(top).map do |entry|
        next if entry.blank?
        e = entry.with_indifferent_access if entry.respond_to?(:with_indifferent_access)
        cid = (e["championId"] || e[:championId]).to_s
        info = champ_data[cid] || {}
        (e || entry).merge("name" => info["name"], "key" => info["key"])
      end.compact
    end

    bg = result["bestGame"] || result[:bestGame]
    if bg.present?
      bg = bg.with_indifferent_access if bg.respond_to?(:with_indifferent_access)
      cid = (bg["championId"] || bg[:championId]).to_s
      info = champ_data[cid] || {}
      result["bestGame"] = bg.merge("name" => info["name"], "key" => info["key"])
    end

    wg = result["worstGame"] || result[:worstGame]
    if wg.present?
      wg = wg.with_indifferent_access if wg.respond_to?(:with_indifferent_access)
      cid = (wg["championId"] || wg[:championId]).to_s
      info = champ_data[cid] || {}
      result["worstGame"] = wg.merge("name" => info["name"], "key" => info["key"])
    end

    wi = result["winrateInsights"] || result[:winrateInsights]
    if wi.present?
      wi = wi.dup
      %w[bestChampion worstChampion].each do |key|
        entry = wi[key]
        next if entry.blank?
        entry = entry.with_indifferent_access if entry.respond_to?(:with_indifferent_access)
        cid = (entry["championId"] || entry[:championId]).to_s
        info = champ_data[cid] || {}
        wi[key] = entry.merge("name" => info["name"], "key" => info["key"])
      end
      result["winrateInsights"] = wi
    end

    result
  end

  def enrich_extra_stats_bot_lane(extra_stats)
    return extra_stats if extra_stats.blank?
    bls = extra_stats["botLaneSynergy"] || extra_stats[:botLaneSynergy]
    return extra_stats if bls.blank?
    result = extra_stats.dup
    result["botLaneSynergy"] = (result["botLaneSynergy"] || {}).dup
    %w[topDuos rideOrDie].each do |key|
      val = result["botLaneSynergy"][key]
      next if val.blank?
      if val.is_a?(Array)
        result["botLaneSynergy"][key] = val.map do |entry|
          next entry if entry.blank?
          e = entry.with_indifferent_access if entry.respond_to?(:with_indifferent_access)
          riot_id = e["teammateRiotId"] || e[:teammateRiotId]
          puuid = e["teammatePuuid"] || e[:teammatePuuid]
          (e || entry).merge("teammateName" => format_teammate_name(riot_id, puuid))
        end.compact
      elsif val.is_a?(Hash)
        e = val.with_indifferent_access if val.respond_to?(:with_indifferent_access)
        riot_id = (e || val)["teammateRiotId"] || (e || val)[:teammateRiotId]
        puuid = (e || val)["teammatePuuid"] || (e || val)[:teammatePuuid]
        result["botLaneSynergy"][key] = (e || val).merge("teammateName" => format_teammate_name(riot_id, puuid))
      end
    end
    result
  end

  def format_ban_list(bans)
    return [] if bans.blank?
    champ_data = champion_data_by_id
    Array(bans).map do |b|
      b = b.with_indifferent_access if b.respond_to?(:with_indifferent_access)
      cid = b["champion_id"] || b[:champion_id]
      next if cid.blank?
      info = champ_data[cid.to_s] || {}
      { champion_id: cid, count: b["count"] || b[:count] || 0, name: info["name"], key: info["key"] }
    end.compact
  end

  def champion_data_by_id
    Rails.cache.fetch("ddragon_champions_v#{ITEM_CDN_VERSION}", expires_in: 1.day) do
      fetch_ddragon_json("https://ddragon.leagueoflegends.com/cdn/#{ITEM_CDN_VERSION}/data/en_US/champion.json") do |data|
        result = {}
        (data["data"] || {}).each do |champ_key, champ|
          kid = champ["key"]
          result[kid] = { "name" => champ["name"], "key" => champ_key } if kid.present?
        end
        result
      end || {}
    end
  end

  def item_name(item_id)
    return nil if item_id.blank?
    names = Rails.cache.fetch("ddragon_items_v#{ITEM_CDN_VERSION}", expires_in: 1.day) do
      fetch_ddragon_json("https://ddragon.leagueoflegends.com/cdn/#{ITEM_CDN_VERSION}/data/en_US/item.json") do |data|
        (data["data"] || {}).transform_values { |v| v["name"] }
      end || {}
    end
    names&.[](item_id.to_s)
  end

  def fetch_ddragon_json(url)
    uri = URI(url)
    res = Net::HTTP.get_response(uri)
    return nil unless res.is_a?(Net::HTTPSuccess)
    data = JSON.parse(res.body)
    block_given? ? yield(data) : data
  rescue OpenSSL::SSL::SSLError, Net::OpenTimeout, Net::ReadTimeout, JSON::ParserError,
         Errno::ECONNRESET, Errno::ETIMEDOUT, SocketError
    nil
  end

  def sanitize_riot_id_input(input)
    return "" if input.blank?
    input.encode("UTF-8", invalid: :replace, undef: :replace)
        .gsub(/[\x00-\x1F\x7F\u2028\u2029]/, "")
        .strip
        .truncate(25, omission: "")
  end

  def format_teammate_name(riot_id, puuid)
    return riot_id if riot_id.present?
    return "…#{puuid[-6..]}" if puuid.to_s.length >= 6
    "Unknown"
  end
end
