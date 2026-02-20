# frozen_string_literal: true

require "faraday"

class RiotClient
  class NotFound < StandardError; end
  class ApiError < StandardError; end

  BASE_URL_TEMPLATE = "https://%<region>s.api.riotgames.com"
  VALID_REGIONS = %w[americas europe asia sea].freeze

  def initialize(api_key: ENV["RIOT_API_KEY"])
    @api_key = api_key
  end

  def fetch_account_by_riot_id(game_name:, tag_line:, region:)
    validate_region!(region)

    base_url = BASE_URL_TEMPLATE % { region: region }
    encoded_game_name = ERB::Util.url_encode(game_name)
    encoded_tag_line = ERB::Util.url_encode(tag_line)
    path = "/riot/account/v1/accounts/by-riot-id/#{encoded_game_name}/#{encoded_tag_line}"

    response = Faraday.get(
      "#{base_url}#{path}",
      nil,
      {
        "X-Riot-Token" => api_key,
        "Accept" => "application/json"
      }
    )

    case response.status
    when 200
      JSON.parse(response.body, symbolize_names: true)
    when 404
      raise NotFound, "Riot account not found"
    else
      raise ApiError, "Riot API error: #{response.status}"
    end
  end

  private

  attr_reader :api_key

  def validate_region!(region)
    return if VALID_REGIONS.include?(region.to_s.downcase)

    raise ArgumentError, "Invalid region: #{region}. Must be one of: #{VALID_REGIONS.join(', ')}"
  end
end
