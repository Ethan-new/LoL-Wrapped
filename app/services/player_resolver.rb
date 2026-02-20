# frozen_string_literal: true

# Resolves puuid to a Player (riot_id). Finds in DB or fetches from Riot and stores.
class PlayerResolver
  def initialize(riot_client: RiotClient.new)
    @riot_client = riot_client
  end

  def resolve(puuid:, region:)
    return nil if puuid.blank?

    player = Player.find_by(puuid: puuid)
    return player.riot_id if player&.riot_id.present?

    account = @riot_client.fetch_account_by_puuid(puuid: puuid, region: region)
    riot_id = "#{account[:gameName]}##{account[:tagLine]}"

    if player
      player.update!(riot_id: riot_id, region: region)
    else
      Player.create!(puuid: puuid, riot_id: riot_id, region: region)
    end

    riot_id
  rescue RiotClient::NotFound, RiotClient::ApiError
    nil
  end
end
