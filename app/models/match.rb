# frozen_string_literal: true

class Match < ApplicationRecord
  validates :match_uid, presence: true, uniqueness: true
  validates :region, presence: true
  validates :game_start_at, presence: true
  validates :year, presence: true, numericality: { only_integer: true }
end
