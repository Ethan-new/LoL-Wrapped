# frozen_string_literal: true

require "test_helper"

class PlayersIngestTest < ActionDispatch::IntegrationTest
  setup do
    @player = Player.create!(
      puuid: "test-puuid-123",
      riot_id: "Player#NA1",
      region: "americas"
    )
  end

  test "POST /players/:id/ingest_year validates year and returns 202 when valid" do
    assert_enqueued_with(job: IngestYearJob, args: [ @player.id, 2025 ]) do
      post "/players/#{@player.id}/ingest_year", params: { year: 2025 }, as: :json
    end

    assert_response :accepted
    json = response.parsed_body
    assert_equal "queued", json["status"]
    assert_equal @player.id, json["player_id"]
    assert_equal 2025, json["year"]
    assert json["job_id"].present?
  end

  test "POST /players/:id/ingest_year rejects year < 2010" do
    post "/players/#{@player.id}/ingest_year", params: { year: 2009 }, as: :json

    assert_response :unprocessable_entity
    json = response.parsed_body
    assert json["error"].include?("2010")
  end

  test "POST /players/:id/ingest_year rejects year > current year" do
    post "/players/#{@player.id}/ingest_year", params: { year: Time.current.year + 1 }, as: :json

    assert_response :unprocessable_entity
    json = response.parsed_body
    assert json["error"].include?(Time.current.year.to_s)
  end

  test "POST /players/:id/ingest_year returns 404 for unknown player" do
    post "/players/99999/ingest_year", params: { year: 2025 }, as: :json

    assert_response :not_found
    assert response.parsed_body["error"]
  end

  test "POST /players/:id/ingest_year returns 409 when recap already in progress" do
    IngestLock.new.acquire!(@player.id)

    post "/players/#{@player.id}/ingest_year", params: { year: 2025 }, as: :json

    assert_response :conflict
    assert response.parsed_body["error"].include?("already in progress")
  ensure
    IngestLock.new.release!(@player.id)
  end
end
