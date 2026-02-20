# frozen_string_literal: true

module RegionMapping
  # URL/display slugs -> Riot API region values
  REGION_TO_RIOT = {
    "na" => "americas",
    "eu" => "europe",
    "asia" => "asia",
    "sea" => "sea"
  }.freeze

  RIOT_TO_REGION = REGION_TO_RIOT.invert.freeze

  def self.riot_region(slug)
    REGION_TO_RIOT[slug.to_s.downcase] || slug
  end

  def self.region_slug(riot_region)
    RIOT_TO_REGION[riot_region.to_s.downcase] || riot_region
  end
end
