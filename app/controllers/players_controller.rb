# frozen_string_literal: true

class PlayersController < ApplicationController
  skip_before_action :verify_authenticity_token, if: -> { request.format.json? }
  skip_before_action :allow_browser, if: -> { request.format.json? }, raise: false

  def index
  end

  def compute_recap
    player = Player.find_by(id: params[:id])
    return render json: { error: "Player not found" }, status: :not_found unless player

    year = params[:year].to_i
    if year < 2010 || year > Time.current.year
      return render json: { error: "Year must be an integer between 2010 and #{Time.current.year}" }, status: :unprocessable_entity
    end

    ComputeMostPlayedWithJob.perform_later(player.id, year)
    render json: {
      status: "queued",
      player_id: player.id,
      year: year,
      message: "ComputeMostPlayedWithJob enqueued"
    }, status: :accepted
  end

  def ingest_year
    player = Player.find_by(id: params[:id])
    return render json: { error: "Player not found" }, status: :not_found unless player

    if IngestLock.new.locked?(player.id)
      return render json: { error: "Recap generation already in progress. Please wait for it to finish." }, status: :conflict
    end

    year = params[:year].to_i
    if year < 2010 || year > Time.current.year
      return render json: { error: "Year must be an integer between 2010 and #{Time.current.year}" }, status: :unprocessable_entity
    end

    job = IngestYearJob.perform_later(player.id, year)
    render json: {
      status: "queued",
      player_id: player.id,
      year: year,
      job_id: job.job_id
    }, status: :accepted
  end

  def show
    game_name, tag_line = params[:riot_id_slug].to_s.rpartition("-").then { |name, _, tag| [name, tag] }
    riot_id = "#{game_name}##{tag_line}"
    riot_region = RegionMapping.riot_region(params[:region])
    @player = Player.find_by!(riot_id: riot_id, region: riot_region)
  rescue ActiveRecord::RecordNotFound
    return respond_to_error("Player not found", [], :not_found)
  end

  def update
    @player = load_player_from_params
    return head :not_found unless @player

    if @player.last_synced_at && @player.last_synced_at > 5.seconds.ago
      respond_to do |format|
        format.html { redirect_to player_path(region: params[:region], riot_id_slug: params[:riot_id_slug]), alert: "Please wait 5 seconds before updating again." }
        format.json { render json: { error: "Rate limited. Try again in 5 seconds." }, status: :too_many_requests }
      end
      return
    end

    refresh_player_data(@player)

    respond_to do |format|
      format.html { redirect_to player_path(region: params[:region], riot_id_slug: params[:riot_id_slug]), notice: "Profile updated." }
      format.json { render json: player_response(@player), status: :ok }
    end
  rescue RiotClient::NotFound, RiotClient::ApiError => e
    respond_to do |format|
      format.html { redirect_to player_path(region: params[:region], riot_id_slug: params[:riot_id_slug]), alert: "Failed to update: #{e.message}" }
      format.json { render json: { error: e.message }, status: :unprocessable_entity }
    end
  end

  def lookup
    unless valid_params?
      return respond_to_error("Missing required parameters", param_errors, :unprocessable_entity)
    end

    riot_region = RegionMapping.riot_region(lookup_params[:region])
    riot_id = "#{lookup_params[:game_name]}##{lookup_params[:tag_line]}"
    player = Player.find_by(riot_id: riot_id, region: riot_region)

    unless player
      account_data = fetch_riot_account
      player = find_or_create_player(account_data)
    end

    respond_to_success(player)
  rescue RiotClient::NotFound
    respond_to_error("Riot account not found", [], :not_found)
  rescue RiotClient::ApiError, RiotClient::ArgumentError => e
    respond_to_error(e.message, [], :unprocessable_entity)
  rescue ActiveRecord::RecordInvalid => e
    respond_to_error("Failed to save player", e.record.errors.full_messages, :unprocessable_entity)
  end

  private

  def lookup_params
    params.permit(:game_name, :tag_line, :region)
  end

  def valid_params?
    param_errors.empty?
  end

  def param_errors
    errors = []
    errors << "game_name is required" if lookup_params[:game_name].blank?
    errors << "tag_line is required" if lookup_params[:tag_line].blank?
    errors << "region is required" if lookup_params[:region].blank?
    errors
  end

  def fetch_riot_account
    riot_region = RegionMapping.riot_region(lookup_params[:region])
    RiotClient.new.fetch_account_by_riot_id(
      game_name: lookup_params[:game_name],
      tag_line: lookup_params[:tag_line],
      region: riot_region
    )
  end

  def find_or_create_player(account_data)
    puuid = account_data[:puuid]
    riot_id = "#{account_data[:gameName]}##{account_data[:tagLine]}"
    riot_region = RegionMapping.riot_region(lookup_params[:region])

    summoner_result = fetch_summoner_data(puuid, riot_region)
    summoner_data = summoner_result&.dig(:data)
    platform = summoner_result&.dig(:platform)

    rank_entries = fetch_rank_entries_by_puuid(puuid, riot_region, platform: platform)

    Player.find_or_initialize_by(puuid: puuid).tap do |player|
      player.riot_id = riot_id
      player.region = riot_region
      if summoner_data
        player.summoner_id = summoner_data[:id]
        player.summoner_level = summoner_data[:summonerLevel]
        player.profile_icon_id = summoner_data[:profileIconId]
        player.revision_date = summoner_data[:revisionDate]
      end
      player.rank_entries = rank_entries
      player.save!
    end
  end

  def fetch_summoner_data(puuid, region)
    RiotClient.new.fetch_summoner_by_puuid(puuid: puuid, region: region)
  rescue RiotClient::NotFound, RiotClient::ApiError
    nil
  end

  def fetch_rank_entries_by_puuid(puuid, region, platform: nil)
    RiotClient.new.fetch_league_entries_by_puuid(puuid: puuid, region: region, platform: platform)
  rescue RiotClient::ApiError
    []
  end

  def load_player_from_params
    game_name, tag_line = params[:riot_id_slug].to_s.rpartition("-").then { |name, _, tag| [name, tag] }
    riot_id = "#{game_name}##{tag_line}"
    riot_region = RegionMapping.riot_region(params[:region])
    Player.find_by(riot_id: riot_id, region: riot_region)
  end

  def refresh_player_data(player)
    summoner_result = fetch_summoner_data(player.puuid, player.region)
    summoner_data = summoner_result&.dig(:data)
    platform = summoner_result&.dig(:platform)
    rank_entries = fetch_rank_entries_by_puuid(player.puuid, player.region, platform: platform)

    player.transaction do
      if summoner_data
        player.summoner_id = summoner_data[:id]
        player.summoner_level = summoner_data[:summonerLevel]
        player.profile_icon_id = summoner_data[:profileIconId]
        player.revision_date = summoner_data[:revisionDate]
      end
      player.rank_entries = rank_entries
      player.last_synced_at = Time.current
      player.save!
    end
  end

  def player_response(player)
    {
      id: player.id,
      url: player_url(region: player.path_params[:region], riot_id_slug: player.riot_id_slug),
      puuid: player.puuid,
      riot_id: player.riot_id,
      region: RegionMapping.region_slug(player.region),
      summoner_id: player.summoner_id,
      summoner_level: player.summoner_level,
      profile_icon_id: player.profile_icon_id,
      revision_date: player.revision_date,
      rank_entries: player.rank_entries,
      created_at: player.created_at,
      updated_at: player.updated_at
    }
  end

  def respond_to_success(player)
    respond_to do |format|
      format.html { redirect_to player_path(region: player.path_params[:region], riot_id_slug: player.riot_id_slug), notice: "Player found." }
      format.json { render json: player_response(player), status: :ok }
    end
  end

  def respond_to_error(message, details, status)
    respond_to do |format|
      format.html { render :lookup_error, locals: { error: message, details: details }, status: status }
      format.json { render json: { error: message, details: details }, status: status }
    end
  end
end
