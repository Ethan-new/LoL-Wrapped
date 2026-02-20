# frozen_string_literal: true

require "test_helper"

class RecapsTest < ActionDispatch::IntegrationTest
  setup do
    @player = Player.create!(
      puuid: "test-puuid-recap",
      riot_id: "RecapPlayer#NA1",
      region: "americas"
    )
  end

  test "GET /players/:id/recap/:year returns sorted results" do
    RecapPerson.create!(player_id: @player.id, year: 2025, teammate_puuid: "teammate-a", games: 42, wins_together: 21)
    RecapPerson.create!(player_id: @player.id, year: 2025, teammate_puuid: "teammate-b", games: 10, wins_together: 8)
    RecapPerson.create!(player_id: @player.id, year: 2025, teammate_puuid: "teammate-c", games: 42, wins_together: 25)

    get "/players/#{@player.id}/recap/2025", as: :json

    assert_response :ok
    json = response.parsed_body
    assert_equal @player.id, json["player_id"]
    assert_equal 2025, json["year"]

    most_played = json["most_played_with"]
    assert_equal 3, most_played.size

    # Sorted by games desc, then wins_together desc
    assert_equal "teammate-c", most_played[0]["teammate_puuid"]
    assert_equal 42, most_played[0]["games"]
    assert_equal 25, most_played[0]["wins_together"]

    assert_equal "teammate-a", most_played[1]["teammate_puuid"]
    assert_equal 42, most_played[1]["games"]
    assert_equal 21, most_played[1]["wins_together"]

    assert_equal "teammate-b", most_played[2]["teammate_puuid"]
    assert_equal 10, most_played[2]["games"]
    assert_equal 8, most_played[2]["wins_together"]
  end

  test "GET /players/:id/recap/:year returns 404 for unknown player" do
    get "/players/99999/recap/2025", as: :json

    assert_response :not_found
  end

  test "GET /players/:id/recap/:year rejects invalid year" do
    get "/players/#{@player.id}/recap/2000", as: :json

    assert_response :unprocessable_entity
  end
end
