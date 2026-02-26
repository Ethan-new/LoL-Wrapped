# frozen_string_literal: true

require "test_helper"

class PlayersIngestTest < ActionDispatch::IntegrationTest
  setup do
    @player = Player.create!(
      puuid: "test-puuid-123",
      riot_id: "Player#NA1",
      region: "americas"
    )
    @previous_year = Time.current.year - 1
  end

  test "POST /players/:id/ingest_year validates year and returns 202 when valid" do
    assert_enqueued_with(job: IngestYearJob, args: [ @player.id, @previous_year ]) do
      post "/players/#{@player.id}/ingest_year", params: { year: @previous_year }, as: :json
    end

    assert_response :accepted
    json = response.parsed_body
    assert_equal "queued", json["status"]
    assert_equal @player.id, json["player_id"]
    assert_equal @previous_year, json["year"]
    assert json["job_id"].present?
  end

  test "POST /players/:id/ingest_year rejects year other than previous year" do
    previous_year = Time.current.year - 1

    post "/players/#{@player.id}/ingest_year", params: { year: 2009 }, as: :json
    assert_response :unprocessable_entity
    assert response.parsed_body["error"].include?(previous_year.to_s)

    post "/players/#{@player.id}/ingest_year", params: { year: Time.current.year + 1 }, as: :json
    assert_response :unprocessable_entity
    assert response.parsed_body["error"].include?(previous_year.to_s)
  end

  test "POST /players/:id/ingest_year returns 404 for unknown player" do
    post "/players/99999/ingest_year", params: { year: @previous_year }, as: :json

    assert_response :not_found
    assert response.parsed_body["error"]
  end

  test "POST /players/:id/ingest_year returns 409 when recap already in progress" do
    IngestLock.new.acquire!(@player.id)

    post "/players/#{@player.id}/ingest_year", params: { year: @previous_year }, as: :json

    assert_response :conflict
    assert response.parsed_body["error"].include?("already in progress")
  ensure
    IngestLock.new.release!(@player.id)
  end

  test "POST /players/:id/ingest_year with force releases lock and allows retry after failure" do
    IngestLock.new.acquire!(@player.id)

    assert_enqueued_with(job: IngestYearJob, args: [ @player.id, @previous_year ]) do
      post "/players/#{@player.id}/ingest_year", params: { year: @previous_year, force: true }, as: :json
    end

    assert_response :accepted
  end
end
