# frozen_string_literal: true

class RecapsController < ApplicationController
  skip_before_action :verify_authenticity_token, if: -> { request.format.json? }
  skip_before_action :allow_browser, raise: false

  def show
    player = Player.find_by(id: params[:id])
    return render json: { error: "Player not found" }, status: :not_found unless player

    year = params[:year].to_i
    if year < 2010 || year > Time.current.year
      return render json: { error: "Year must be an integer between 2010 and #{Time.current.year}" }, status: :unprocessable_entity
    end

    most_played_with = RecapPerson
      .where(player_id: player.id, year: year)
      .order(games: :desc, wins_together: :desc)
      .limit(20)
      .map do |r|
        riot_id = r.teammate_riot_id.presence || Player.find_by(puuid: r.teammate_puuid)&.riot_id
        {
          teammate_puuid: r.teammate_puuid,
          teammate_riot_id: riot_id,
          teammate_name: format_teammate_name(riot_id, r.teammate_puuid),
          games: r.games,
          wins_together: r.wins_together
        }
      end

    year_stat = RecapYearStat.find_by(player_id: player.id, year: year)

    most_beat_us = RecapEnemy
      .where(player_id: player.id, year: year)
      .order(times_beat_us: :desc)
      .limit(5)
      .map do |r|
        riot_id = r.enemy_riot_id.presence || Player.find_by(puuid: r.enemy_puuid)&.riot_id
        {
          enemy_puuid: r.enemy_puuid,
          enemy_riot_id: riot_id,
          enemy_name: format_teammate_name(riot_id, r.enemy_puuid),
          times_beat_us: r.times_beat_us
        }
      end

    fav_items = (year_stat&.fav_items || []).map do |fi|
      fi = fi.with_indifferent_access if fi.respond_to?(:with_indifferent_access)
      id = fi["item_id"] || fi[:item_id]
      next if id.blank?
      { item_id: id, count: fi["count"] || fi[:count] || 0, name: item_name(id) }
    end.compact

    extra_stats = year_stat&.extra_stats || {}
    our_team_bans = format_ban_list(year_stat&.our_team_bans)
    enemy_team_bans = format_ban_list(year_stat&.enemy_team_bans)

    render json: {
      player_id: player.id,
      year: year,
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

  ITEM_CDN_VERSION = "14.24.1"

  private

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
      uri = URI("https://ddragon.leagueoflegends.com/cdn/#{ITEM_CDN_VERSION}/data/en_US/champion.json")
      res = Net::HTTP.get_response(uri)
      data = res.is_a?(Net::HTTPSuccess) ? JSON.parse(res.body) : {}
      result = {}
      (data["data"] || {}).each do |champ_key, champ|
        kid = champ["key"]
        result[kid] = { "name" => champ["name"], "key" => champ_key } if kid.present?
      end
      result
    end
  end

  def item_name(item_id)
    return nil if item_id.blank?
    names = Rails.cache.fetch("ddragon_items_v#{ITEM_CDN_VERSION}", expires_in: 1.day) do
      uri = URI("https://ddragon.leagueoflegends.com/cdn/#{ITEM_CDN_VERSION}/data/en_US/item.json")
      res = Net::HTTP.get_response(uri)
      data = res.is_a?(Net::HTTPSuccess) ? JSON.parse(res.body) : {}
      (data["data"] || {}).transform_values { |v| v["name"] }
    end
    names&.[](item_id.to_s)
  end

  def format_teammate_name(riot_id, puuid)
    return riot_id if riot_id.present?
    return "…#{puuid[-6..]}" if puuid.to_s.length >= 6
    "Unknown"
  end
end
