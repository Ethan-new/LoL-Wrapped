# frozen_string_literal: true

require "test_helper"

class RecapsTest < ActionDispatch::IntegrationTest
  setup do
    @player = Player.create!(
      puuid: "test-puuid-recap",
      riot_id: "RecapPlayer#NA1",
      region: "americas"
    )
    @previous_year = Time.current.year - 1
  end

  test "GET /players/:id/recap/:year returns sorted results" do
    RecapYearStat.create!(
      player_id: @player.id,
      year: @previous_year,
      most_played_with: [
        { "teammate_puuid" => "teammate-c", "teammate_riot_id" => nil, "teammate_name" => "…te-c", "games" => 42, "wins_together" => 25 },
        { "teammate_puuid" => "teammate-a", "teammate_riot_id" => nil, "teammate_name" => "…te-a", "games" => 42, "wins_together" => 21 },
        { "teammate_puuid" => "teammate-b", "teammate_riot_id" => nil, "teammate_name" => "…te-b", "games" => 10, "wins_together" => 8 }
      ],
      most_beat_us: []
    )

    get "/players/#{@player.id}/recap/#{@previous_year}", as: :json

    assert_response :ok
    json = response.parsed_body
    assert_equal @player.id, json["player_id"]
    assert_equal @previous_year, json["year"]

    most_played = json["most_played_with"]
    assert_equal 3, most_played.size

    # Sorted by games desc, then wins_together desc (stored pre-sorted)
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
    get "/players/99999/recap/#{@previous_year}", as: :json

    assert_response :not_found
  end

  test "GET /players/:id/recap/:year rejects invalid year" do
    get "/players/#{@player.id}/recap/2000", as: :json

    assert_response :unprocessable_entity
  end

  test "GET /players/:region/:riot_id_slug/:year/recap renders recap page" do
    region = RegionMapping.region_slug(@player.region)
    riot_id_slug = @player.riot_id_slug

    get "/players/#{region}/#{riot_id_slug}/#{@previous_year}/recap"

    assert_response :ok
    assert_select "div[data-controller='recap'][data-recap-autoload-value='true']"
    assert_match(/Back to profile/, response.body)
  end

  test "GET /players/:region/:riot_id_slug/:year/recap redirects for invalid year" do
    region = RegionMapping.region_slug(@player.region)
    riot_id_slug = @player.riot_id_slug

    get "/players/#{region}/#{riot_id_slug}/2000/recap"

    assert_redirected_to player_path(region: region, riot_id_slug: riot_id_slug)
  end
end
