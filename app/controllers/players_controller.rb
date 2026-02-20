# frozen_string_literal: true

class PlayersController < ApplicationController
  skip_before_action :verify_authenticity_token, if: -> { request.format.json? }
  skip_before_action :allow_browser, if: -> { request.format.json? }, raise: false

  def index
  end

  def lookup
    unless valid_params?
      return respond_to_error("Missing required parameters", param_errors, :unprocessable_entity)
    end

    riot_id = "#{lookup_params[:game_name]}##{lookup_params[:tag_line]}"
    player = Player.find_by(riot_id: riot_id, region: lookup_params[:region])

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
    RiotClient.new.fetch_account_by_riot_id(
      game_name: lookup_params[:game_name],
      tag_line: lookup_params[:tag_line],
      region: lookup_params[:region]
    )
  end

  def find_or_create_player(account_data)
    puuid = account_data[:puuid]
    riot_id = "#{account_data[:gameName]}##{account_data[:tagLine]}"
    region = lookup_params[:region]

    Player.find_or_initialize_by(puuid: puuid).tap do |player|
      player.riot_id = riot_id
      player.region = region
      player.save!
    end
  end

  def player_response(player)
    {
      id: player.id,
      puuid: player.puuid,
      riot_id: player.riot_id,
      region: player.region,
      created_at: player.created_at,
      updated_at: player.updated_at
    }
  end

  def respond_to_success(player)
    respond_to do |format|
      format.html { render :lookup_success, locals: { player: player }, status: :ok }
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
