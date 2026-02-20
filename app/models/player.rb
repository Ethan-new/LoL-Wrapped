# frozen_string_literal: true

class Player < ApplicationRecord
  has_many :recap_people, dependent: :destroy
  has_many :recap_enemies, dependent: :destroy
  has_many :recap_year_stats, dependent: :destroy

  # year_match_ids (jsonb): { "2025" => ["NA1_123", ...], "2024" => [...] }
  # recap_statuses (jsonb): { "2025" => "generating"|"ready"|"failed", "2024" => "ready", ... }
  # Data Dragon version for profile icons - update when assets stop loading
  PROFILE_ICON_BASE_URL = "https://ddragon.leagueoflegends.com/cdn/14.24.1/img/profileicon"

  validates :puuid, presence: true, uniqueness: true

  def profile_icon_url
    return nil unless profile_icon_id.present?

    "#{PROFILE_ICON_BASE_URL}/#{profile_icon_id}.png"
  end

  def game_name
    riot_id.to_s.split("#", 2).first.presence
  end

  def tag_line
    riot_id.to_s.split("#", 2).second.presence
  end

  def riot_id_slug
    "#{game_name}-#{tag_line}"
  end

  def path_params
    { region: RegionMapping.region_slug(region), riot_id_slug: riot_id_slug }
  end

  def region_display
    RegionMapping.region_slug(region)&.upcase
  end

  def solo_rank_entry
    find_rank_entry("RANKED_SOLO_5x5")
  end

  def flex_rank_entry
    find_rank_entry("RANKED_FLEX_SR")
  end

  def rank_display(entry)
    return nil unless entry.present?

    tier = (entry["tier"] || entry[:tier]).to_s.titleize
    rank = (entry["rank"] || entry[:rank]).to_s
    lp = entry["leaguePoints"] || entry[:leaguePoints] || 0
    "#{tier} #{rank} #{lp} LP"
  end

  def rank_wins_losses(entry)
    return nil unless entry.present?

    wins = entry["wins"] || entry[:wins] || 0
    losses = entry["losses"] || entry[:losses] || 0
    "#{wins}W #{losses}L"
  end

  def recap_status_for(year)
    return "ready" if recap_year_stats.exists?(year: year)

    (recap_statuses || {}).dig(year.to_s) || nil
  end

  def recap_generating_for?(year)
    recap_status_for(year) == "generating"
  end

  private

  def find_rank_entry(queue_type)
    entries = rank_entries || []
    return nil if entries.blank?

    entries.find { |e| (e["queueType"] || e[:queueType]) == queue_type }
  end
end
