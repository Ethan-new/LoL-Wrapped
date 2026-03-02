# frozen_string_literal: true

class CleanUnusedExtraStats < ActiveRecord::Migration[8.1]
  KEYS_TO_REMOVE = %w[
    playstyleIdentity clutchChaosMoments economyScaling visionMapIq damageProfile
    botLaneSynergy mostPopularQueueType timeByQueue memeTitles winrateInsights
    streaks timePlayedHeatmap avgCsPerMin saveAllyFromDeath
    skillshotsHit skillshotsDodged outnumberedKills soloKills timeCCingOthers
    totalTimeCCDealt scuttleCrabKills buffsStolen totalLastHits
  ].freeze

  def up
    RecapYearStat.find_each do |stat|
      next if stat.extra_stats.blank?

      cleaned = stat.extra_stats.dup
      KEYS_TO_REMOVE.each { |k| cleaned.delete(k.to_s); cleaned.delete(k.to_sym) }

      # Slim championPersonality to only mostPlayedChampion
      cp = cleaned["championPersonality"] || cleaned[:championPersonality]
      if cp.is_a?(Hash)
        most_played = cp["mostPlayedChampion"] || cp[:mostPlayedChampion]
        if most_played.present?
          cleaned["championPersonality"] = { "mostPlayedChampion" => most_played }
        else
          cleaned.delete("championPersonality")
          cleaned.delete(:championPersonality)
        end
      end

      stat.update_columns(extra_stats: cleaned) if cleaned != stat.extra_stats
    end
  end

  def down
    # Irreversible: removed data cannot be restored
  end
end
